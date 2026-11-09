import type { Api } from "./api.js";
import { Capture, MENU_ID } from "./capture.js";

export function start(api: Api, userAgent: string): Capture {
  const capture = new Capture(api, userAgent);
  api.runtime.onInstalled.addListener(() => {
    api.contextMenus.create({
      id: MENU_ID,
      title: "Download with Tug",
      contexts: ["link", "image", "video", "audio"],
    });
  });
  api.downloads.onCreated.addListener((item) => {
    void capture.created(item);
  });
  api.contextMenus.onClicked.addListener((info, tab) => {
    void capture.clicked(info, tab);
  });
  return capture;
}
