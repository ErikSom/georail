import axios from "axios";

export const proxyGoogleTiles = async (req, res) => {
	try {
		const path = req.params[0];
		const session = req.query.session;

		// validate path
		if (!/^[\w/.-]+$/i.test(path)) {
			return res.status(400).json({
				error: 'Invalid tile path format',
				details: 'Path contains invalid characters'
			});
		}

		let googleUrl = `https://tile.googleapis.com/v1/3dtiles/${path}?key=${process.env.GOOGLE_API_KEY}`;

		if (path !== 'root.json') {
			// validate session ID
			const sessionRegex = /^[A-Za-z0-9_-]{10,64}$/;
			if (!session || !sessionRegex.test(session)) {
				return res.status(400).json({
					error: 'Invalid session token',
					details: 'Session token must be an alphanumeric string of 10-64 characters'
				});
			}

			googleUrl += `&session=${session}`;
		}

		// comply to https://developers.google.com/maps/documentation/tile/policies#pre-fetching,-caching,-or-storage-of-content
		const response = await axios({
			method: 'get',
			url: googleUrl,
			responseType: 'stream',
			headers: {
				'Accept': req.headers.accept,
				'User-Agent': req.headers['user-agent'],
				'If-None-Match': req.headers['if-none-match'],
				'If-Modified-Since': req.headers['if-modified-since'],
				'Referer': 'https://api.georail.app'
			},
			validateStatus: status => (status >= 200 && status < 300) || status === 304,
			timeout: 5000
		});

		// make sure to forward all headers
		Object.entries(response.headers).forEach(([key, value]) => {
			res.setHeader(key, value);
		});

		res.status(response.status);

		response.data.pipe(res);
	} catch (error) {
		console.error('Proxy error:', error.message);
		res.status(error.response?.status || 500).json({
			error: 'Failed to fetch tile data',
			details: error.response?.statusText
		});
	}
};
