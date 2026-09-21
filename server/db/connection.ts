import mongoose from 'mongoose';
import { config } from '../config';

let isConnected = false;

export async function connectDB(): Promise<boolean> {
  if (!config.mongodbUri) {
    console.log('[DB] No MONGODB_URI provided. Running in high-performance transactional in-memory store mode for development/demo.');
    return false;
  }

  try {
    await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log('[DB] Connected successfully to MongoDB Atlas cluster.');
    return true;
  } catch (error) {
    console.warn('[DB] MongoDB connection failed. Falling back to in-memory store:', (error as Error).message);
    isConnected = false;
    return false;
  }
}

export function isDbConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}

export async function closeDB(): Promise<void> {
  if (isConnected) {
    await mongoose.connection.close();
    isConnected = false;
    console.log('[DB] MongoDB connection closed gracefully.');
  }
}
