import handler from "./statistics.mjs";

function apiResponse(response) {
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

export async function statisticsMiddleware(request, response, next) {
	const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
	if (url.pathname !== "/api/statistics") {
		return next();
	}

	request.query = Object.fromEntries(url.searchParams);
	await handler(request, apiResponse(response));
}
