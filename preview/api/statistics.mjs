import mysql from "mysql2/promise";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function requiredEnvironment(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function identifier(name, fallback) {
	const value = process.env[name] || fallback;
	if (!IDENTIFIER_PATTERN.test(value)) {
		throw new Error(`${name} must be a valid MySQL identifier`);
	}
	return `\`${value}\``;
}

function identifierValue(name, fallback) {
	const value = process.env[name] || fallback;
	if (!IDENTIFIER_PATTERN.test(value)) {
		throw new Error(`${name} must be a valid MySQL identifier`);
	}
	return value;
}

function leaderboardLimit(request) {
	const requested = Number.parseInt(request.query?.limit, 10);
	if (!Number.isFinite(requested)) {
		return DEFAULT_LIMIT;
	}
	return Math.min(Math.max(requested, 1), MAX_LIMIT);
}

function positiveInteger(value, name, maximum) {
	if (value === undefined || value === "") {
		return null;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1 || (maximum && parsed > maximum)) {
		throw new Error(`${name} must be a valid positive integer`);
	}
	return parsed;
}

function databaseConfig() {
	const common = {
		enableKeepAlive: true,
		connectTimeout: 5000,
		supportBigNumbers: true,
		bigNumberStrings: true,
	};

	if (process.env.DATABASE_URL) {
		return {
			uri: process.env.DATABASE_URL,
			options: common,
		};
	}

	return {
		options: {
			...common,
			host: requiredEnvironment("MYSQL_HOST"),
			port: Number.parseInt(process.env.MYSQL_PORT || "3306", 10),
			user: requiredEnvironment("MYSQL_USER"),
			password: requiredEnvironment("MYSQL_PASSWORD"),
			database: requiredEnvironment("MYSQL_DATABASE"),
			ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined,
		},
	};
}

async function openConnection() {
	const config = databaseConfig();
	if (config.uri) {
		return mysql.createConnection({
			uri: config.uri,
			...config.options,
		});
	}
	return mysql.createConnection(config.options);
}

export default async function handler(request, response) {
	if (request.method !== "GET") {
		response.setHeader("Allow", "GET");
		return response.status(405).json({ error: "Method not allowed" });
	}

	let connection;
	try {
		const tableName = identifierValue("MYSQL_ACTIVITY_TABLE", "staffactivity");
		const table = `\`${tableName}\``;
		const uuidColumn = identifier("MYSQL_UUID_COLUMN", "uuid");
		const nameColumn = identifier("MYSQL_NAME_COLUMN", "name");
		const lastActivityColumn = identifier("MYSQL_LAST_ACTIVITY_COLUMN", "last_activity");
		const amountChatColumn = identifier("MYSQL_AMOUNT_CHAT_COLUMN", "amount_chat");
		const dayColumn = identifier("MYSQL_DAY_COLUMN", "day");
		const monthColumn = identifier("MYSQL_MONTH_COLUMN", "month");
		const yearColumn = identifier("MYSQL_YEAR_COLUMN", "year");
		const limit = leaderboardLimit(request);
		const requestedMonth = positiveInteger(request.query?.month, "month", 12);
		const requestedYear = positiveInteger(request.query?.year, "year");

		connection = await openConnection();

		const [periodRows] = await connection.query(
			`SELECT DISTINCT ${yearColumn} AS year, ${monthColumn} AS month
			FROM ${table}
			ORDER BY ${yearColumn} DESC, ${monthColumn} DESC`,
		);
		const latestPeriod = periodRows[0] || null;
		const selectedPeriod = requestedMonth && requestedYear
			? { month: requestedMonth, year: requestedYear }
			: latestPeriod;

		if (!selectedPeriod) {
			response.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
			return response.status(200).json({
				summary: { totalStaff: 0, totalChat: 0, trackedDays: 0 },
				top: [],
				chart: [],
				storageBytes: 0,
				periods: [],
				selectedPeriod: null,
				generatedAt: new Date().toISOString(),
			});
		}

		const periodParameters = [selectedPeriod.year, selectedPeriod.month];
		const [summaryRows] = await connection.query(
			`SELECT COUNT(DISTINCT ${uuidColumn}) AS totalStaff,
				COALESCE(SUM(${amountChatColumn}), 0) AS totalChat,
				COALESCE(SUM(${lastActivityColumn}), 0) AS totalActivity,
				(
					COALESCE(SUM(${amountChatColumn}), 0)
					+ COALESCE(SUM(${lastActivityColumn}), 0) * 2
				) AS totalPoints,
				COUNT(DISTINCT ${dayColumn}) AS trackedDays
			FROM ${table}
			WHERE ${yearColumn} = ? AND ${monthColumn} = ?`,
			periodParameters,
		);
		const [topRows] = await connection.query(
			`SELECT ${uuidColumn} AS uuid,
				MAX(${nameColumn}) AS name,
				COALESCE(SUM(${lastActivityColumn}), 0) AS lastActivity,
				COALESCE(SUM(${amountChatColumn}), 0) AS amountChat,
				(
					COALESCE(SUM(${amountChatColumn}), 0)
					+ COALESCE(SUM(${lastActivityColumn}), 0) * 2
				) AS points
			FROM ${table}
			WHERE ${yearColumn} = ? AND ${monthColumn} = ?
			GROUP BY ${uuidColumn}
			ORDER BY points DESC, amountChat DESC, lastActivity DESC
			LIMIT ?`,
			[...periodParameters, limit],
		);
		const [chartRows] = await connection.query(
			`SELECT ${dayColumn} AS day,
				COALESCE(SUM(${amountChatColumn}), 0) AS amountChat,
				COALESCE(SUM(${lastActivityColumn}), 0) AS activityTime,
				(
					COALESCE(SUM(${amountChatColumn}), 0)
					+ COALESCE(SUM(${lastActivityColumn}), 0) * 2
				) AS points
			FROM ${table}
			WHERE ${yearColumn} = ? AND ${monthColumn} = ?
			GROUP BY ${dayColumn}
			ORDER BY ${dayColumn}`,
			periodParameters,
		);
		const [storageRows] = await connection.query(
			`SELECT COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS bytes
			FROM information_schema.TABLES
			WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
			[requiredEnvironment("MYSQL_DATABASE"), tableName],
		);

		const summary = summaryRows[0];
		response.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=300");
		return response.status(200).json({
			summary: {
				totalStaff: Number(summary.totalStaff),
				totalChat: Number(summary.totalChat),
				totalActivity: Number(summary.totalActivity),
				totalPoints: Number(summary.totalPoints),
				trackedDays: Number(summary.trackedDays),
			},
			top: topRows,
			chart: chartRows,
			storageBytes: storageRows[0]?.bytes || 0,
			periods: periodRows,
			selectedPeriod,
			generatedAt: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Unable to load player statistics", error);
		return response.status(500).json({
			error: "Unable to load player statistics",
			code: error.code || "STATISTICS_API_ERROR",
			detail: error.message || "Unknown database error",
		});
	} finally {
		await connection?.end();
	}
}
