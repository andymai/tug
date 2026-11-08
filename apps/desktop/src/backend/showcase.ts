import type { SeedDownload } from "./mock";

const MB = 1 << 20;
const GB = 1024 * MB;

export const SHOWCASE: readonly SeedDownload[] = [
  { url: "https://download.example.org/fedora-kde-44-x86_64.iso", state: "downloading", progress: 0.71, size: 4.2 * GB },
  { url: "https://mirror.example.org/blender/blender-5.1-linux-x64.tar.xz", state: "queued", size: 412 * MB },
  { url: "https://media.example.org/talks/conference-talk-1080p.mp4", state: "paused", progress: 0.38, size: 1.6 * GB },
  { url: "https://fonts.example.org/noto-fonts-2026.11.zip", state: "done", size: 186 * MB, dir: "/home/you/Downloads/Fonts" },
  {
    url: "https://mirror.example.org/data/dataset-shard-07.parquet",
    state: "failed",
    progress: 0.12,
    size: 940 * MB,
    error: "couldn't reach mirror.example.org",
  },
];
