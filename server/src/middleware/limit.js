import rateLimit from 'express-rate-limit';

export const tileLimiter = rateLimit({
	windowMs: 1000, // 1 second
	max: 10, // limit each IP to 1 requests per second
	message: 'Too many path requests, please try again later'
});
