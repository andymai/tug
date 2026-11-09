import { Archive, Disc, File, FileText, Film, Image, type LucideIcon, Music, Package } from "lucide-react";

import type { Category } from "../backend/backend";

export const CATEGORIES: readonly { id: Category; label: string; command: string; icon: LucideIcon }[] = [
  { id: "video", label: "Videos", command: "Show videos", icon: Film },
  { id: "audio", label: "Audio", command: "Show audio", icon: Music },
  { id: "image", label: "Images", command: "Show images", icon: Image },
  { id: "document", label: "Documents", command: "Show documents", icon: FileText },
  { id: "archive", label: "Archives", command: "Show archives", icon: Archive },
  { id: "program", label: "Programs", command: "Show programs", icon: Package },
  { id: "disk", label: "Disk images", command: "Show disk images", icon: Disc },
  { id: "other", label: "Other files", command: "Show other files", icon: File },
];

export function isCategory(value: string): value is Category {
  return CATEGORIES.some((category) => category.id === value);
}
