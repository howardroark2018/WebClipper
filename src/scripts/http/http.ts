import {RequestError} from "./requestError";

interface RejectPackage {
	response: XMLHttpRequest;
	requestError: RequestError;
}

/**
 * Helper class for performing http requests. This is a WIP and has barebones functionality, but
 * can be added to as necessary.
 */
export class Http {
	private static defaultTimeout = 30000;

	public static get(url: string, headers?: any, timeout = Http.defaultTimeout): Promise<XMLHttpRequest> {
		return new Promise<XMLHttpRequest>((resolve, reject) => {
			let request = new XMLHttpRequest();
			request.open("GET", url);

			request.timeout = timeout;

			request.onload = () => {
				resolve(request);
			};

			request.onerror = () => {
				reject(Http.createRejectPackage(request, RequestError.NetworkError));
			};

			request.ontimeout = () => {
				reject(Http.createRejectPackage(request, RequestError.RequestTimedOut));
			};

			for (let key in headers) {
				request.setRequestHeader(key, headers[key]);
			}

			request.send();
		});
	}

	private static createRejectPackage(request: XMLHttpRequest, requestError: RequestError) {
		return {
			request: request,
			requestError: RequestError
		};
	}
}