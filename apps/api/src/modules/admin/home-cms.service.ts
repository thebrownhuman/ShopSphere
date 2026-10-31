import { HttpStatus, Injectable } from '@nestjs/common';
import type { HomeSection as HomeSectionRow, Prisma } from '@prisma/client';
import type {
  AdminHomeSection,
  HomeAudience,
  HomeResponse,
  HomeSectionInput,
  HomeSectionType,
} from '@shopsphere/types';
import { HomeService } from '../home/home.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';

function view(r: HomeSectionRow): AdminHomeSection {
  return {
    id: r.id,
    type: r.type as HomeSectionType,
    title: r.title,
    dataSource: (r.dataSource ?? {}) as Record<string, unknown>,
    position: r.position,
    audience: r.audience as HomeAudience,
    active: r.active,
    startsAt: r.startsAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
  };
}

/** Home-page CMS (M6.7): CRUD + drag-order of home_sections, scheduled windows, preview. */
@Injectable()
export class HomeCmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly home: HomeService,
  ) {}

  async list(): Promise<AdminHomeSection[]> {
    const rows = await this.prisma.homeSection.findMany({ orderBy: { position: 'asc' } });
    return rows.map(view);
  }

  private data(input: HomeSectionInput) {
    if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
      throw new AppError('SCHEDULE_INVALID', 'End must be after start');
    }
    return {
      type: input.type,
      title: input.title,
      dataSource: input.dataSource as Prisma.InputJsonValue,
      audience: input.audience,
      active: input.active,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    };
  }

  async create(input: HomeSectionInput): Promise<AdminHomeSection> {
    const last = await this.prisma.homeSection.aggregate({ _max: { position: true } });
    const row = await this.prisma.homeSection.create({
      data: { ...this.data(input), position: (last._max.position ?? 0) + 10 },
    });
    return view(row);
  }

  async update(id: string, input: HomeSectionInput): Promise<AdminHomeSection> {
    await this.require(id);
    return view(await this.prisma.homeSection.update({ where: { id }, data: this.data(input) }));
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.require(id);
    await this.prisma.homeSection.delete({ where: { id } });
    return { id };
  }

  /** `ids` is the full new order; positions are rewritten 10, 20, 30 … in one transaction. */
  async reorder(ids: string[]): Promise<AdminHomeSection[]> {
    const existing = await this.prisma.homeSection.findMany({ select: { id: true } });
    const all = new Set(existing.map((r) => r.id));
    if (ids.length !== all.size || new Set(ids).size !== ids.length || ids.some((i) => !all.has(i)))
      throw new AppError('REORDER_INVALID', 'Send every section id exactly once');
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.homeSection.update({ where: { id }, data: { position: (i + 1) * 10 } }),
      ),
    );
    return this.list();
  }

  /** What a guest or signed-in shopper would see at `at` (schedules applied). */
  preview(at: Date, audience: 'GUEST' | 'SIGNED_IN'): Promise<HomeResponse> {
    return this.home.home(
      { userId: audience === 'SIGNED_IN' ? 'preview' : null, ownerKey: null },
      at,
    );
  }

  private async require(id: string) {
    if (!(await this.prisma.homeSection.findUnique({ where: { id } })))
      throw new AppError('NOT_FOUND', 'Section not found', HttpStatus.NOT_FOUND);
  }
}
