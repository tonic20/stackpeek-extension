export async function getInstallId(): Promise<string> {
  const { install_id } = await chrome.storage.local.get("install_id");
  if (install_id) return install_id as string;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ install_id: id });
  return id;
}
