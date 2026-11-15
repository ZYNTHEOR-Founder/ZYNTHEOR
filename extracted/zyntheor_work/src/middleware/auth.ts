import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';
import { isCloudSqlConfigured } from '../db/index.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export const requireFirebaseAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    if (isCloudSqlConfigured()) {
      await getOrCreateUser(
        decodedToken.uid,
        decodedToken.email || `${decodedToken.uid}@firebase.local`,
        decodedToken.name || null
      );
    }
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' });
  }
};
