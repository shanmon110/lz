export type BotFilterMode = "exclude" | "include" | "only";

export interface DashboardFilters {
  from?: string;
  to?: string;
  ip?: string;
  country?: string;
  path?: string;
  bots: BotFilterMode;
  page: number;
}

export class DashboardFilterError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "DashboardFilterError";
  }
}

const TEXT_LIMITS = {
  ip: 45,
  country: 2,
  path: 2048
} as const;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(name: "from" | "to", value: string | null): string | undefined {
  if (value === null || value === "") {
    return undefined;
  }

  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new DashboardFilterError(`${name} must be a YYYY-MM-DD date`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new DashboardFilterError(`${name} must be a valid date`);
  }

  return value;
}

function dateNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function parseTextFilter(
  searchParams: URLSearchParams,
  name: keyof typeof TEXT_LIMITS
): string | undefined {
  const value = searchParams.get(name);
  if (value === null || value === "") {
    return undefined;
  }
  if (value.length > TEXT_LIMITS[name]) {
    throw new DashboardFilterError(
      `${name} must be at most ${TEXT_LIMITS[name]} characters`
    );
  }
  return value;
}

function parseBots(value: string | null): BotFilterMode {
  if (value === null || value === "") {
    return "exclude";
  }
  if (value === "exclude" || value === "include" || value === "only") {
    return value;
  }
  throw new DashboardFilterError("bots must be exclude, include, or only");
}

function parsePage(value: string | null): number {
  if (value === null || value === "") {
    return 1;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new DashboardFilterError("page must be a positive integer");
  }
  const page = Number(value);
  if (!Number.isSafeInteger(page)) {
    throw new DashboardFilterError("page must be a positive integer");
  }
  return page;
}

export function parseDashboardFilters(
  searchParams: URLSearchParams
): DashboardFilters {
  const from = parseDate("from", searchParams.get("from"));
  const to = parseDate("to", searchParams.get("to"));
  const ip = parseTextFilter(searchParams, "ip");
  const country = parseTextFilter(searchParams, "country");
  const path = parseTextFilter(searchParams, "path");

  if (Boolean(from) !== Boolean(to)) {
    throw new DashboardFilterError(
      "from and to must be provided together for a bounded date range"
    );
  }

  if (from && to) {
    const inclusiveDays = (dateNumber(to) - dateNumber(from)) / DAY_MS + 1;
    if (inclusiveDays < 1) {
      throw new DashboardFilterError("from must not be after to");
    }
    if (inclusiveDays > 90) {
      throw new DashboardFilterError("date range must not exceed 90 days");
    }
  }

  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(ip ? { ip } : {}),
    ...(country ? { country } : {}),
    ...(path ? { path } : {}),
    bots: parseBots(searchParams.get("bots")),
    page: parsePage(searchParams.get("page"))
  };
}
