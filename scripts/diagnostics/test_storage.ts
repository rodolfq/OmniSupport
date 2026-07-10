import { MockDB } from './lib/mock-db';

// Mock browser environment for localStorage
if (typeof window === 'undefined') {
  (global as any).window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    }
  };
}

try {
  const users = MockDB.getUsers();
  console.log('Users found:', users.length);
} catch (e) {
  console.error('Error fetching users:', e);
}
