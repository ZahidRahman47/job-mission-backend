// FR-039, FR-040: contacts and interactions.
import { describe, expect, it } from 'vitest';
import { createApplication, data, loggedInUser, type App } from './helpers.ts';

interface Contact {
  id: string;
  name: string;
  title: string | null;
}
interface Activity {
  type: string;
  contactId: string | null;
  applicationId: string | null;
  data: Record<string, unknown>;
}

describe('contacts', () => {
  it('creates, searches, updates and validates contacts', async () => {
    const { agent } = await loggedInUser();
    const jane = data<Contact>(
      await agent
        .post('/api/v1/contacts')
        .send({
          name: 'Jane Doe',
          title: 'Recruiter',
          email: 'jane@acme.example',
          linkedinUrl: 'https://www.linkedin.com/in/jane',
        })
        .expect(201),
    );
    await agent.post('/api/v1/contacts').send({ name: 'John Smith' }).expect(201);

    const search = await agent.get('/api/v1/contacts?q=jan').expect(200);
    expect(data<Contact[]>(search).map((c) => c.name)).toEqual(['Jane Doe']);

    const updated = await agent
      .patch(`/api/v1/contacts/${jane.id}`)
      .send({ title: 'Head of Talent' })
      .expect(200);
    expect(data<Contact>(updated).title).toBe('Head of Talent');

    await agent.post('/api/v1/contacts').send({ name: 'Bad', email: 'not-an-email' }).expect(400);
    await agent
      .post('/api/v1/contacts')
      .send({ name: 'Bad', linkedinUrl: 'http://insecure.example' })
      .expect(400);
  });

  it('logs an interaction on the contact and on the linked application timeline', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const contact = data<Contact>(
      await agent.post('/api/v1/contacts').send({ name: 'Jane' }).expect(201),
    );

    await agent
      .post(`/api/v1/contacts/${contact.id}/interactions`)
      .send({ channel: 'call', summary: 'Intro call', applicationId: app.id })
      .expect(201);

    const history = data<Activity[]>(
      await agent.get(`/api/v1/contacts/${contact.id}/interactions`).expect(200),
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: 'contact_interaction',
      data: { channel: 'call', contactName: 'Jane' },
    });

    const timeline = data<Activity[]>(
      await agent.get(`/api/v1/applications/${app.id}/activities`).expect(200),
    );
    expect(timeline.map((a) => a.type)).toContain('contact_interaction');
  });

  it('deleting a contact unlinks it from applications', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent);
    const contact = data<Contact>(
      await agent.post('/api/v1/contacts').send({ name: 'Jane' }).expect(201),
    );
    await agent
      .put(`/api/v1/applications/${app.id}/contacts`)
      .send({ contactIds: [contact.id] })
      .expect(200);

    await agent.delete(`/api/v1/contacts/${contact.id}`).expect(204);
    const after = data<App>(await agent.get(`/api/v1/applications/${app.id}`).expect(200));
    expect(after.contactIds).toEqual([]);
  });
});
