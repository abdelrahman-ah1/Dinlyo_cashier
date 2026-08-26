import { getDb } from './db.js';

export async function authenticatePin(pin) {
  if (!pin) return null;
  const db = getDb();
  const user = await db.collection('users').findOne({ pin: String(pin), is_active: 1 });
  if (!user) return null;
  return {
    id: user.id || user._id,
    _id: user._id,
    branch_id: user.branch_id,
    name: user.name,
    role: user.role,
  };
}

export async function extractUserFromRequest(req) {
  const userId = req.headers['x-user-id'];
  const userRole = req.headers['x-user-role'];
  const userName = req.headers['x-user-name'];

  if (userId) {
    try {
      const db = getDb();
      const dbUser = await db.collection('users').findOne({
        $or: [{ id: userId }, { _id: userId }],
        is_active: 1,
      });
      if (dbUser) {
        return {
          id: dbUser.id || dbUser._id,
          _id: dbUser._id,
          name: dbUser.name,
          role: dbUser.role,
          branch_id: dbUser.branch_id,
        };
      }
    } catch {
      // Fallback
    }
  }

  if (userRole && userName) {
    return {
      id: userId || 'custom-user',
      name: decodeURIComponent(userName),
      role: userRole,
    };
  }

  // Fallback default operator if no header is provided (e.g. from generic LAN terminal)
  return {
    id: 'default-operator',
    name: 'Staff Operator',
    role: 'cashier',
  };
}

export function hasPermission(userRole, requiredRole) {
  const hierarchy = {
    manager: 3,
    shift_manager: 2,
    cashier: 1,
  };
  const userLevel = hierarchy[userRole] || 0;
  const reqLevel = hierarchy[requiredRole] || 0;
  return userLevel >= reqLevel;
}
