import { isEmail } from "validator";
import { Pool } from "pg";
import { InternalErrorResponse } from "./responses";

const apiKeyRegex = /^[a-zA-Z0-9-]{32}$/;

const findUserByApiKeyQuery = `
    select id, key, email, enabled, staff, created_at, updated_at 
    from account 
    where key = $1
    `;

const findUserByEmailQuery = `
    select id, key, email, enabled, staff, created_at, updated_at 
    from account 
    where email = $1
    `;

const createApiKeyQuery = `
    insert into account (key, email, enabled, staff) 
    select $1, $2::varchar(100), $3, $4 
    where not exists (select id from account where email = $2) 
    returning id, key, email, enabled, staff
    `;

interface User {
  id: number;
  key: string;
  email: string;
  enabled: boolean;
  staff: boolean;
  created_at: Date;
  updated_at: Date;
}

export default class ApiKeyRepository {
  constructor(db: Pool) {
    this.db = db;
  }

  private db: Pool;

  isApiKeyValid(apiKey: string): boolean {
    return apiKeyRegex.test(apiKey);
  }

  isValidEmail(email: string): boolean {
    return isEmail(email) && email.length <= 100;
  }

  async findUserByApiKey(apiKey: string): Promise<User | unknown> {
    const results = await this.db.query(findUserByApiKeyQuery, [apiKey]);
    if (results.rows.length > 0) {
      return results.rows[0];
    }

    return null;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const results = await this.db.query(findUserByEmailQuery, [email]);
    if (results.rows.length > 0) {
      return results.rows[0];
    }

    return null;
  }

  async createAccount(
    key: string,
    email: string,
    enabled: boolean,
    staff: boolean,
  ): Promise<void | InternalErrorResponse> {
    const results = await this.db.query(createApiKeyQuery, [
      key,
      email,
      enabled,
      staff,
    ]);

    console.log(
      "Created account for email:",
      email,
      " rows affected: ",
      results.rowCount,
    );
  }
}
