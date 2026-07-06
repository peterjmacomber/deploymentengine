import { Router } from 'express';
import { loginSchema } from '@de/shared';
import { userService } from '../../services/userService.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const result = await userService.login(email, password);
    res.json(result);
  }),
);

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ principal: req.principal });
});
