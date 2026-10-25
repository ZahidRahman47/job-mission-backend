// FR-035 to FR-038: companies, de-duplication, rename sync, delete-in-use.
import { describe, expect, it } from 'vitest';
import { createApplication, data, errorCode, loggedInUser, type App } from './helpers.ts';

interface Company {
  id: string;
  name: string;
}

describe('companies', () => {
  it('creates a company and rejects the same name with different case and spacing', async () => {
    const { agent } = await loggedInUser();
    const created = data<Company>(
      await agent
        .post('/api/v1/companies')
        .send({ name: 'Acme Corp', website: 'https://acme.example' })
        .expect(201),
    );
    const duplicate = await agent
      .post('/api/v1/companies')
      .send({ name: '  ACME   corp ' })
      .expect(409);
    expect(duplicate.body).toMatchObject({
      error: { code: 'ALREADY_EXISTS', details: { existingId: created.id } },
    });
  });

  it('lists A-Z with prefix search and pagination metadata', async () => {
    const { agent } = await loggedInUser();
    for (const name of ['Globex', 'Acme', 'Acorn Labs', 'Initech']) {
      await agent.post('/api/v1/companies').send({ name }).expect(201);
    }
    const all = await agent.get('/api/v1/companies?limit=2').expect(200);
    expect(data<Company[]>(all).map((c) => c.name)).toEqual(['Acme', 'Acorn Labs']);
    expect(all.body).toMatchObject({ meta: { page: 1, limit: 2, total: 4, totalPages: 2 } });

    const prefix = await agent.get('/api/v1/companies?q=ac').expect(200);
    expect(data<Company[]>(prefix).map((c) => c.name)).toEqual(['Acme', 'Acorn Labs']);
  });

  it('shows application count and contacts on the detail page', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent, { companyName: 'Initech' });
    await agent
      .post('/api/v1/contacts')
      .send({ name: 'Bill', companyId: app.companyId })
      .expect(201);
    const detail = await agent.get(`/api/v1/companies/${app.companyId}`).expect(200);
    expect(detail.body).toMatchObject({
      data: { name: 'Initech', applicationCount: 1, contacts: [{ name: 'Bill' }] },
    });
  });

  it('renaming updates the name shown on its applications', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent, { companyName: 'Old Name' });
    await agent.patch(`/api/v1/companies/${app.companyId}`).send({ name: 'New Name' }).expect(200);
    const updated = data<App>(await agent.get(`/api/v1/applications/${app.id}`).expect(200));
    expect(updated.companyName).toBe('New Name');
  });

  it('rejects renaming to a name that already exists', async () => {
    const { agent } = await loggedInUser();
    await agent.post('/api/v1/companies').send({ name: 'Taken' }).expect(201);
    const other = data<Company>(
      await agent.post('/api/v1/companies').send({ name: 'Free' }).expect(201),
    );
    const res = await agent
      .patch(`/api/v1/companies/${other.id}`)
      .send({ name: 'taken' })
      .expect(409);
    expect(errorCode(res)).toBe('ALREADY_EXISTS');
  });

  it('blocks deleting a company that applications use, and detaches contacts otherwise', async () => {
    const { agent } = await loggedInUser();
    const app = await createApplication(agent, { companyName: 'In Use' });
    const blocked = await agent.delete(`/api/v1/companies/${app.companyId}`).expect(409);
    expect(blocked.body).toMatchObject({
      error: { code: 'COMPANY_IN_USE', details: { count: 1 } },
    });

    const free = data<Company>(
      await agent.post('/api/v1/companies').send({ name: 'Unused' }).expect(201),
    );
    const contact = data<{ id: string }>(
      await agent.post('/api/v1/contacts').send({ name: 'Jane', companyId: free.id }).expect(201),
    );
    await agent.delete(`/api/v1/companies/${free.id}`).expect(204);
    const after = await agent.get(`/api/v1/contacts/${contact.id}`).expect(200);
    expect(data<{ companyId: string | null }>(after).companyId).toBeNull();
  });
});
