import { createServer } from "node:http";
import handler from "./statistics.mjs";

process.env.STATISTICS_LOCAL_DEVELOPMENT = "true";

const port = Number.parseInt(process.env.STATISTICS_API_PORT || "3001", 10);

function vercelResponse(response) {
	return {
		setHeader(name, value) {
			response.setHeader(name, value);
		},
		status(statusCode) {
			response.statusCode = statusCode;
			return this;
		},
		json(body) {
			response.setHeader("Content-Type", "application/json; charset=utf-8");
			response.end(JSON.stringify(body));
		},
	};
}

const server = createServer(async (request, response) => {
	const url = new URL(request.url, `http://${request.headers.host}`);
	response.setHeader("Access-Control-Allow-Origin", "*");
	response.setHeader("Access-Control-Allow-Methods", "GET");
	response.setHeader("Access-Control-Allow-Headers", "Accept");

	if (url.pathname !== "/api/statistics") {
		response.statusCode = 404;
		response.end("Not found");
		return;
	}

	request.query = Object.fromEntries(url.searchParams);
	await handler(request, vercelResponse(response));
});

server.listen(port, () => {
	console.log(`Statistics API listening on http://localhost:${port}/api/statistics`);
});
