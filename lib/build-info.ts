type BuildInfo = {
  sha: string;
  ts: string;
};

const normalizeTimestamp = (value: string | undefined | null): string => {
  if (!value) {
    return 'unknown';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 'unknown';
  }

  const numericValue = Number(trimmed);
  if (!Number.isNaN(numericValue) && /^[0-9]+$/.test(trimmed)) {
    const milliseconds = trimmed.length <= 10 ? numericValue * 1000 : numericValue;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return trimmed;
};

const detectBuildInfo = (): BuildInfo => {
  const sha =
    process.env.BUILD_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_GIT_SHA ??
    'unknown';

  const ts = normalizeTimestamp(
    process.env.BUILD_TIMESTAMP ??
      process.env.VERCEL_GIT_COMMIT_TIMESTAMP ??
      process.env.DEPLOYMENT_TIMESTAMP ??
      process.env.NOW_GITHUB_COMMIT_DATETIME ??
      process.env.SOURCE_DATE_EPOCH,
  );

  return {
    sha,
    ts,
  };
};

let cachedBuildInfo: BuildInfo | null = null;

export const getBuildInfo = (): BuildInfo => {
  if (!cachedBuildInfo) {
    cachedBuildInfo = detectBuildInfo();
  }
  return cachedBuildInfo;
};

export const resetBuildInfoCache = () => {
  cachedBuildInfo = null;
};
