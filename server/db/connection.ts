import mongoose from 'mongoose';
import { config } from '../config';

let isConnected = false;

export async function connectDB(): Promise<boolean> {
  if (!config.mongodbUri) {
    if (config.isProduction) {
      throw new Error('FATAL: MONGODB_URI environment variable is required in production!');
    }
    console.warn('[DB] Warning: MONGODB_URI is not set. Persistent database operations will fail until MongoDB is configured.');
    return false;
  }

  try {
    await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log('[DB] Connected successfully to MongoDB database.');
    return true;
  } catch (error) {
    isConnected = false;
    const msg = (error as Error).message;
    console.error('[DB] MongoDB connection error:', msg);
    if (config.isProduction) {
      throw new Error(`FATAL: Failed to connect to MongoDB in production: ${msg}`);
    }
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
