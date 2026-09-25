import { createInterface } from 'node:readline';

import { ToolInputError, validateToolInput } from './input-schema.mjs';

const supportedProtocolVersions = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05'
];
const maxMessageBytes = 1024 * 1024;

const jsonRpcErrors = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603
};

class ToolFailure extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const toolResult = (structuredContent, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
  structuredContent,
  isError
});

const describeTool = ({ handler: _handler, ...tool }) => tool;

const createMcpServer = ({ serverInfo, instructions, tools, log }) => {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  let initialized = false;

  const callTool = async (params) => {
    const tool = toolsByName.get(params?.name);

    if (!tool) {
      return toolResult(
        {
          ok: false,
          error: { code: 'UNKNOWN_TOOL', message: 'Unknown tool.' }
        },
        true
      );
    }

    try {
      const input = validateToolInput(tool.inputSchema, params.arguments);
      return toolResult({ ok: true, ...(await tool.handler(input)) });
    } catch (error) {
      if (error instanceof ToolInputError) {
        return toolResult(
          {
            ok: false,
            error: { code: 'INVALID_INPUT', message: error.message }
          },
          true
        );
      }

      if (error instanceof ToolFailure) {
        return toolResult(
          {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              ...error.details
            }
          },
          true
        );
      }

      log(`Tool ${tool.name} failed: ${error.message}`);
      return toolResult(
        {
          ok: false,
          error: { code: 'TOOL_FAILED', message: error.message }
        },
        true
      );
    }
  };

  const handleRequest = async (message) => {
    const { method, params } = message;

    if (method === 'initialize') {
      initialized = true;
      const requested = params?.protocolVersion;

      return {
        protocolVersion: supportedProtocolVersions.includes(requested)
          ? requested
          : supportedProtocolVersions[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo,
        instructions
      };
    }

    if (method === 'ping') {
      return {};
    }

    if (!initialized) {
      throw Object.assign(new Error('Server not initialized.'), {
        rpcCode: jsonRpcErrors.invalidRequest
      });
    }

    if (method === 'tools/list') {
      return { tools: tools.map(describeTool) };
    }

    if (method === 'tools/call') {
      return callTool(params);
    }

    throw Object.assign(new Error(`Method not found: ${method}`), {
      rpcCode: jsonRpcErrors.methodNotFound
    });
  };

  const handleMessage = async (line) => {
    if (Buffer.byteLength(line, 'utf-8') > maxMessageBytes) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: jsonRpcErrors.invalidRequest,
          message: 'Message too large.'
        }
      };
    }

    let message;

    try {
      message = JSON.parse(line);
    } catch {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: jsonRpcErrors.parse, message: 'Parse error.' }
      };
    }

    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string'
    ) {
      if (message && typeof message === 'object' && 'result' in message) {
        return null;
      }

      return {
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: {
          code: jsonRpcErrors.invalidRequest,
          message: 'Invalid request.'
        }
      };
    }

    const isNotification = !Object.hasOwn(message, 'id');

    if (isNotification) {
      return null;
    }

    try {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: await handleRequest(message)
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: error.rpcCode ?? jsonRpcErrors.internal,
          message: error.rpcCode ? error.message : 'Internal error.'
        }
      };
    }
  };

  return { handleMessage };
};

const serveStdio = ({
  server,
  input = process.stdin,
  output = process.stdout
}) => {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let queue = Promise.resolve();

  lines.on('line', (line) => {
    if (line.trim().length === 0) {
      return;
    }

    queue = queue.then(async () => {
      const response = await server.handleMessage(line);

      if (response) {
        output.write(`${JSON.stringify(response)}\n`);
      }
    });
  });

  return new Promise((resolve) => {
    lines.on('close', () => queue.then(resolve));
  });
};

export { ToolFailure, createMcpServer, serveStdio, supportedProtocolVersions };
