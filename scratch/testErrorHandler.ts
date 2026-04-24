import { Request, Response } from 'express';
import { AppError, errorHandler } from '../src/middleware/errorHandler';

// Mock logger
const logger = {
  error: (...args: any[]) => console.error('LOG ERROR:', ...args),
  warn: (...args: any[]) => console.warn('LOG WARN:', ...args),
};

// Mock Express Response
const mockResponse = () => {
  const res: any = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: any) => {
    res.body = data;
    return res;
  };
  return res;
};

// Test cases
const runTests = () => {
  console.log('--- Testing AppError ---');
  const res1 = mockResponse();
  const err1 = new AppError('Test Message', 400, 'TEST_CODE', { detail: 'info' });
  errorHandler(err1, {} as Request, res1, () => {});
  console.log('Status:', res1.statusCode);
  console.log('Body:', JSON.stringify(res1.body, null, 2));

  console.log('\n--- Testing SyntaxError (JSON) ---');
  const res2 = mockResponse();
  const err2 = new SyntaxError('Unexpected token } in JSON at position 10');
  (err2 as any).body = '{ invalid }';
  errorHandler(err2, { path: '/test' } as Request, res2, () => {});
  console.log('Status:', res2.statusCode);
  console.log('Body:', JSON.stringify(res2.body, null, 2));

  console.log('\n--- Testing Unexpected Error ---');
  const res3 = mockResponse();
  const err3 = new Error('Database crash');
  errorHandler(err3, { path: '/test', method: 'GET' } as Request, res3, () => {});
  console.log('Status:', res3.statusCode);
  console.log('Body:', JSON.stringify(res3.body, null, 2));
};

runTests();
