const getActiveTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

  return tabs[0];
};

const sendToActiveTab = async (message) => {
  const tab = await getActiveTab();

  if (!tab?.id) {
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return null;
  }
};

const updateTabUrl = async (tabId, url) => {
  await chrome.tabs.update(tabId, { url });
};

export { getActiveTab, sendToActiveTab, updateTabUrl };
