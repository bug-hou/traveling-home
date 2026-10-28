import { apiRequest } from './api';

export type ModuleStatus = 'ready' | 'empty' | 'not_ready' | 'unavailable';

export interface RecentFile {
  id: string;
  name: string;
  type: 'file';
  mime: string | null;
  size: number;
  uploadedAt: string | null;
  thumbnailUrl: null;
  processingStatus: null;
  locationStatus: null;
}

export interface HomeSummary {
  generatedAt: string;
  storage: {
    status: ModuleStatus;
    usedBytes: number | null;
    quotaBytes: number | null;
    usagePercent: number | null;
    breakdown: { videoBytes: number; imageBytes: number; audioBytes: number; otherBytes: number } | null;
  };
  files: { status: ModuleStatus; totalFiles: number | null; recent: RecentFile[] };
  footprint: { status: ModuleStatus; countyCount: number | null; cityCount: number | null; provinceCount: number | null; latestCounty: null };
  trips: { status: ModuleStatus; count: number | null; recent: [] };
}

export const homeApi = {
  summary(recentLimit = 4) {
    return apiRequest<HomeSummary>(`/api/v1/home/summary?${new URLSearchParams({ recentLimit: String(recentLimit) })}`);
  },
};
