const showHelp = () => {
  console.log(`Usage: content-kit <command>

Commands:
  init         Generate content-kit.config.json if one is missing.
  apply-edits  Apply a browser-extension edit export over message JSON.
  mcp          Serve the message catalogs to an AI agent over MCP (stdio).
  help         Show this help message.

Options for apply-edits:
  --input, -i   Browser extension JSON export to apply.

Options for mcp:
  --config      content-kit.config.json to use (default: nearest one upwards).

Options for init:
  --project-root Project directory where content-kit.config.json should be created.
`);
};

export { showHelp };
