import {
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { database } from "./database.mjs";
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  get pool() {
    return database();
  }
  async onApplicationShutdown() {
    if (process.env.DB_PASSWORD) await this.pool.end();
  }
}
@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
