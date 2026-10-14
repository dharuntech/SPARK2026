'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const IST_OFFSET_MINUTES = 330;
const EVENT_DATE = '2026-10-15';

function ist(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MINUTES * 60 * 1000);
}

const OFFICIAL_6_EVENTS = [
  {
    code: 'E04',
    name: 'IPL AUCTION',
    category: 'NON_TECHNICAL',
    venue: '322',
    start: '10:00',
    end: '13:00',
    mode: 'BOTH',
    desc: '🏏 IPL AUCTION – SPARK 2026\n\nBuild your dream IPL team! 🔥 Bid for your favourite players, manage your budget, and compete with other teams to create the ultimate cricket squad. Let the bidding battle begin! 💰🏆'
  },
  {
    code: 'E03',
    name: 'Capture The Flag',
    category: 'TECHNICAL',
    venue: 'SHIVA AYUADURAI LAB',
    start: '10:00',
    end: '12:00',
    mode: 'WEBSITE',
    desc: 'Capture The Flag (CTF) is a technical challenge where participants must use their problem-solving and cybersecurity skills to find a hidden flag placed in a folder somewhere on a computer. The participant who discovers the flag first and submits it correctly wins the challenge.'
  },
  {
    code: 'E05',
    name: 'Creovate',
    category: 'TECHNICAL',
    venue: 'DENNIS RICHIE LAB(Right)',
    start: '10:00',
    end: '12:00',
    mode: 'WEBSITE',
    desc: 'Creovate: Technical innovation, design thinking, and rapid prototyping competition.'
  },
  {
    code: 'E06',
    name: 'AuRagen',
    category: 'TECHNICAL',
    venue: 'DENNIS RICHIE LAB(Left)',
    start: '10:00',
    end: '12:00',
    mode: 'WEBSITE',
    desc: 'AuRagen: Advanced generative AI, machine learning and intelligent system building.'
  },
  {
    code: 'E07',
    name: 'Project expo',
    category: 'TECHNICAL',
    venue: 'IOT LAB',
    start: '10:00',
    end: '13:00',
    mode: 'WEBSITE',
    desc: 'Project Expo: Showcase your groundbreaking hardware, IoT, and software projects to expert panels.'
  },
  {
    code: 'E02',
    name: 'NeuraForge',
    category: 'TECHNICAL',
    venue: 'IBM LAB',
    start: '11:30',
    end: '13:00',
    mode: 'WEBSITE',
    desc: 'NeuraForge: Neural network architectures, deep learning engineering, and algorithmic mastery.'
  }
];

const slugify = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function sync() {
  console.log('Syncing official 6 events to local database...');
  
  // Unpublish any test/scratch events that are not in the official 6
  const officialCodes = OFFICIAL_6_EVENTS.map(e => e.code);
  await prisma.event.updateMany({
    where: { code: { notIn: officialCodes }, status: 'PUBLISHED' },
    data: { status: 'DRAFT' }
  });

  for (const e of OFFICIAL_6_EVENTS) {
    const existing = await prisma.event.findUnique({ where: { code: e.code } });
    if (existing) {
      await prisma.event.update({
        where: { code: e.code },
        data: {
          name: e.name,
          category: e.category,
          venue: e.venue,
          description: e.desc,
          registrationMode: e.mode,
          status: 'PUBLISHED',
          startsAt: ist(EVENT_DATE, e.start),
          endsAt: ist(EVENT_DATE, e.end),
          registrationDeadline: ist(EVENT_DATE, '09:00')
        }
      });
      console.log(`Updated event ${e.code}: ${e.name}`);
    } else {
      await prisma.event.create({
        data: {
          code: e.code,
          slug: slugify(e.name),
          name: e.name,
          category: e.category,
          venue: e.venue,
          description: e.desc,
          registrationMode: e.mode,
          status: 'PUBLISHED',
          startsAt: ist(EVENT_DATE, e.start),
          endsAt: ist(EVENT_DATE, e.end),
          registrationDeadline: ist(EVENT_DATE, '09:00')
        }
      });
      console.log(`Created event ${e.code}: ${e.name}`);
    }
  }

  const published = await prisma.event.findMany({
    where: { status: 'PUBLISHED' },
    select: { code: true, name: true }
  });
  console.log('Published events now in DB:', published);
  process.exit(0);
}

sync().catch(err => {
  console.error(err);
  process.exit(1);
});
