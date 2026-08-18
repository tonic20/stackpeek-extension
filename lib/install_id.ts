import { browser } from "wxt/browser";

// Held for the life of the panel document, never written to storage. This is
// what a Firefox user who declined the optional technicalAndInteraction grant
// gets instead of a persisted id.
let ephemeralId: string | undefined;

// Firefox surfaces granted data-collection types through permissions.getAll().
// Chrome has no such concept, so the check is compiled out there entirely.
async function mayPersist(): Promise<boolean> {
  if (!import.meta.env.FIREFOX) return true;
  try {
    const granted = await browser.permissions.getAll();
    const collection = (granted as { data_collection?: string[] }).data_collection;
    return Array.isArray(collection) && collection.includes("technicalAndInteraction");
  } catch {
    // An API that isn't there, or that threw, is not consent. Default closed.
    return false;
  }
}

export async function getInstallId(): Promise<string> {
  if (!(await mayPersist())) {
    // Not "no id": backend/app/controllers/api/v1/detect_controller.rb rejects
    // a blank install_id and uses it as the endpoint's only throttle key, so
    // omitting it would take every detect down. A per-session id keeps the
    // throttle working while leaving nothing on disk and giving the server no
    // way to join one session to the next.
    //
    // Any previously persisted id is deliberately ignored rather than read
    // back — withdrawing the grant has to stop the old id being sent, or
    // withdrawing it means nothing.
    ephemeralId ??= crypto.randomUUID();
    return ephemeralId;
  }

  const { install_id } = await browser.storage.local.get("install_id");
  if (install_id) return install_id as string;
  const id = crypto.randomUUID();
  await browser.storage.local.set({ install_id: id });
  return id;
}
