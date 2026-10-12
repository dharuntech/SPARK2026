'use strict';
const { z } = require('zod');

const registerNumber = z
  .string()
  .trim()
  .min(4, 'Register number looks too short')
  .max(30, 'Register number looks too long')
  .regex(/^[A-Za-z0-9/\-_. ]+$/, 'Use letters, digits, / - _ only');

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(160);
const name = z.string().trim().min(2, 'Please enter your full name').max(120);
const department = z.string().trim().min(2, 'Please choose your department').max(120);
const academicYear = z.string().trim().min(1, 'Please choose your year').max(20);
const section = z.string().trim().min(1, 'Please enter your section').max(10);
const phone = z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number').optional().or(z.literal(''));

const registerSchema = z.object({
  eventId: z.string().trim().min(1, 'Please choose an event'),
  name,
  registerNumber,
  department,
  academicYear,
  section,
  email,
  phone: phone.optional(),
});

const passLookupSchema = z.object({
  registerNumber,
  email,
});

const loginSchema = z.object({
  email,
  password: z.string().min(6, 'Password is required').max(200),
});

const eventBodySchema = z.object({
  name: z.string().trim().min(3, 'Event name is required').max(120),
  category: z.enum(['TECHNICAL', 'NON-TECHNICAL', 'NON_TECHNICAL']).transform((v) => (v === 'NON-TECHNICAL' ? 'NON_TECHNICAL' : v)),
  venue: z.string().trim().min(1, 'Venue is required').max(120),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the event date'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a start time'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Choose an end time'),
  description: z.string().trim().min(5, 'Add a short description').max(1200),
  registrationMode: z.enum(['WEBSITE', 'ON_SPOT', 'BOTH']).default('BOTH'),
  registrationDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Invalid deadline').optional().or(z.literal('')),
  maxCapacity: z.union([z.coerce.number().int().min(1).max(2000), z.literal('')]).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']).optional(),
  code: z.string().trim().max(12).optional(),
});

const onSpotSchema = z.object({
  eventId: z.string().trim().min(1, 'Choose the event'),
  name,
  registerNumber,
  department,
  academicYear,
  section,
  email,
  phone: phone.optional(),
});

const verifySchema = z
  .object({
    eventId: z.string().trim().min(1, 'Choose the event you are scanning for'),
    code: z.string().trim().max(600).optional(),
    registrationId: z.string().trim().max(60).optional(),
  })
  .refine((v) => Boolean(v.code || v.registrationId), { message: 'Provide a scanned QR code or a registration ID' });

const attendancePatchSchema = z.object({
  attendanceStatus: z.enum(['PENDING', 'PRESENT', 'ABSENT']),
});

module.exports = {
  registerSchema,
  passLookupSchema,
  loginSchema,
  eventBodySchema,
  onSpotSchema,
  verifySchema,
  attendancePatchSchema,
};
