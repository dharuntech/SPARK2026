'use strict';
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const request = require('supertest');
const app = require('../src/app');

const prisma = new PrismaClient();

function genStudent(prefix) {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return {
    name: `${prefix} Student ${rand}`,
    registerNumber: `REG-${rand}`,
    department: 'CSE',
    academicYear: 'III',
    section: 'A',
    email: `${prefix.toLowerCase()}_${rand.toLowerCase()}@example.com`,
  };
}

function genMembers(count) {
  const list = [];
  for (let i = 1; i <= count; i++) {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    list.push({
      name: `Member ${i} ${rand}`,
      registerNumber: `MEM-${rand}`,
      department: 'CSE',
      academicYear: 'III',
      section: 'A',
      email: `mem${i}_${rand.toLowerCase()}@example.com`,
    });
  }
  return list;
}

async function runTests() {
  console.log('── Running Event-Specific Team Size & Bug Verification Tests ──\n');

  // Find or create test events
  const nf = await prisma.event.findFirst({ where: { name: { contains: 'NeuroForge', mode: 'insensitive' } } });
  const ag = await prisma.event.findFirst({ where: { name: { contains: 'AuraGen', mode: 'insensitive' } } });
  const cr = await prisma.event.findFirst({ where: { name: { contains: 'Creovate', mode: 'insensitive' } } });
  const ctf = await prisma.event.findFirst({ where: { name: { contains: 'Capture', mode: 'insensitive' } } });

  assert(nf, 'NeuroForge event must exist in database');
  assert(ag, 'AuraGen event must exist in database');
  assert(cr, 'Creovate event must exist in database');
  assert(ctf, 'Capture the Flag event must exist in database');

  const api = request(app);

  // 1. NeuroForge: 2 members (Lead + 1 member) -> REJECT
  console.log('Test 1: NeuroForge with 2 members (1 Lead + 1 Member) -> REJECT');
  const resNF2 = await api.post('/api/registrations').send({
    eventId: nf.id,
    ...genStudent('NF2'),
    teamMembers: genMembers(1),
  });
  assert.equal(resNF2.status, 400, 'Should reject NeuroForge with 2 members');
  assert(/Minimum 3 members/i.test(resNF2.body.error?.message || resNF2.body.message));
  console.log('✔ Passed (Rejected 2 members for NeuroForge)');

  // 2. NeuroForge: 3 members (Lead + 2 members) -> ACCEPT
  console.log('Test 2: NeuroForge with 3 members (1 Lead + 2 Members) -> ACCEPT');
  const resNF3 = await api.post('/api/registrations').send({
    eventId: nf.id,
    ...genStudent('NF3'),
    teamMembers: genMembers(2),
  });
  assert.equal(resNF3.status, 201, 'Should accept NeuroForge with 3 members');
  assert.equal(resNF3.body.pass.teamMembers.length, 2);
  console.log('✔ Passed (Accepted 3 members for NeuroForge, saved 2 additional members)');

  // 3. NeuroForge: 4 members (Lead + 3 members) -> ACCEPT
  console.log('Test 3: NeuroForge with 4 members (1 Lead + 3 Members) -> ACCEPT');
  const resNF4 = await api.post('/api/registrations').send({
    eventId: nf.id,
    ...genStudent('NF4'),
    teamMembers: genMembers(3),
  });
  assert.equal(resNF4.status, 201, 'Should accept NeuroForge with 4 members');
  assert.equal(resNF4.body.pass.teamMembers.length, 3);
  console.log('✔ Passed (Accepted 4 members for NeuroForge)');

  // 4. NeuroForge: 5 members (Lead + 4 members) -> REJECT
  console.log('Test 4: NeuroForge with 5 members (1 Lead + 4 Members) -> REJECT');
  const resNF5 = await api.post('/api/registrations').send({
    eventId: nf.id,
    ...genStudent('NF5'),
    teamMembers: genMembers(4),
  });
  assert.equal(resNF5.status, 400, 'Should reject NeuroForge with 5 members');
  assert(/Maximum 4 members/i.test(resNF5.body.error?.message || resNF5.body.message));
  console.log('✔ Passed (Rejected 5 members for NeuroForge)');

  // 5. AuraGen: 1 member -> ACCEPT
  console.log('Test 5: AuraGen with 1 member (individual) -> ACCEPT');
  const resAG1 = await api.post('/api/registrations').send({
    eventId: ag.id,
    ...genStudent('AG1'),
    teamMembers: [],
  });
  assert.equal(resAG1.status, 201, 'Should accept AuraGen with 1 member');
  console.log('✔ Passed (Accepted 1 member for AuraGen)');

  // 6. AuraGen: 2 members -> ACCEPT
  console.log('Test 6: AuraGen with 2 members -> ACCEPT');
  const resAG2 = await api.post('/api/registrations').send({
    eventId: ag.id,
    ...genStudent('AG2'),
    teamMembers: genMembers(1),
  });
  assert.equal(resAG2.status, 201, 'Should accept AuraGen with 2 members');
  console.log('✔ Passed (Accepted 2 members for AuraGen)');

  // 7. AuraGen: 3 members -> ACCEPT
  console.log('Test 7: AuraGen with 3 members -> ACCEPT');
  const resAG3 = await api.post('/api/registrations').send({
    eventId: ag.id,
    ...genStudent('AG3'),
    teamMembers: genMembers(2),
  });
  assert.equal(resAG3.status, 201, 'Should accept AuraGen with 3 members');
  console.log('✔ Passed (Accepted 3 members for AuraGen)');

  // 8. AuraGen: 4 members -> REJECT
  console.log('Test 8: AuraGen with 4 members (1 Lead + 3 Members) -> REJECT');
  const resAG4 = await api.post('/api/registrations').send({
    eventId: ag.id,
    ...genStudent('AG4'),
    teamMembers: genMembers(3),
  });
  assert.equal(resAG4.status, 400, 'Should reject AuraGen with 4 members');
  assert(/Maximum 3 members/i.test(resAG4.body.error?.message || resAG4.body.message));
  console.log('✔ Passed (Rejected 4 members for AuraGen)');

  // 9. Creovate: 1, 2, 3 members -> ACCEPT; 4 members -> REJECT
  console.log('Test 9: Creovate: 1 to 3 members -> ACCEPT; 4 members -> REJECT');
  const resCR1 = await api.post('/api/registrations').send({
    eventId: cr.id,
    ...genStudent('CR1'),
    teamMembers: [],
  });
  assert.equal(resCR1.status, 201);
  const resCR3 = await api.post('/api/registrations').send({
    eventId: cr.id,
    ...genStudent('CR3'),
    teamMembers: genMembers(2),
  });
  assert.equal(resCR3.status, 201);
  const resCR4 = await api.post('/api/registrations').send({
    eventId: cr.id,
    ...genStudent('CR4'),
    teamMembers: genMembers(3),
  });
  assert.equal(resCR4.status, 400);
  assert(/Maximum 3 members/i.test(resCR4.body.error?.message || resCR4.body.message));
  console.log('✔ Passed (Creovate 1 & 3 accepted, 4 rejected)');

  // 10. Capture the Flag: 1 to 3 members -> ACCEPT; 4 members -> REJECT
  console.log('Test 10: Capture the Flag: 1 to 3 members -> ACCEPT; 4 members -> REJECT');
  const resCTF1 = await api.post('/api/registrations').send({
    eventId: ctf.id,
    ...genStudent('CTF1'),
    teamMembers: [],
  });
  assert.equal(resCTF1.status, 201);
  const resCTF4 = await api.post('/api/registrations').send({
    eventId: ctf.id,
    ...genStudent('CTF4'),
    teamMembers: genMembers(3),
  });
  assert.equal(resCTF4.status, 400);
  assert(/Maximum 3 members/i.test(resCTF4.body.error?.message || resCTF4.body.message));
  console.log('✔ Passed (Capture the Flag 1 accepted, 4 rejected)');

  // 11. Multi-event pass lookup & pass retention
  console.log('Test 11: Multi-event student pass lookup returns both passes with correct details');
  const sharedStudent = genStudent('MULTI');
  const p1 = await api.post('/api/registrations').send({
    eventId: nf.id,
    ...sharedStudent,
    teamMembers: genMembers(2),
  });
  assert.equal(p1.status, 201);

  const p2 = await api.post('/api/registrations').send({
    eventId: ag.id,
    ...sharedStudent,
    teamMembers: genMembers(1),
  });
  assert.equal(p2.status, 201);

  const lookup = await api.post('/api/passes/lookup').send({
    registerNumber: sharedStudent.registerNumber,
    email: sharedStudent.email,
  });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.count, 2);
  const eventsInLookup = lookup.body.passes.map(p => p.event.name);
  assert(eventsInLookup.includes('NeuroForge'));
  assert(eventsInLookup.includes('AuraGen'));
  console.log('✔ Passed (Multi-event student retrieves both NeuroForge and AuraGen passes)');

  console.log('\nAll 11 verification test suites passed successfully!\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
