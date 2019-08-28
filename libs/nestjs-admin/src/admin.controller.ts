import { Get, Post, Controller, Param, Query, Body, Response } from '@nestjs/common'
import { Repository, EntityMetadata } from 'typeorm'
import * as express from 'express'
import DefaultAdminSite from './adminSite'
import DefaultAdminSection from './adminSection'
import DefaultAdminNunjucksEnvironment from './admin.environment'
import * as urls from './utils/urls'

const resultsPerPage = 25

function getPaginationQueryOptions(page: number) {
  // @debt architecture "williamd: this could be made configurable on a per-section basis"
  return {
    skip: resultsPerPage * (page - 1),
    take: resultsPerPage,
  }
}

type AdminModelsQuery = {
  sectionName?: string
  entityName?: string
  primaryKey?: string
}

type AdminModelsResult = {
  section: DefaultAdminSection
  repository: Repository<unknown>
  metadata: EntityMetadata
  entity: object
}

@Controller('admin')
export class DefaultAdminController {
  constructor(
    private defaultAdminSite: DefaultAdminSite,
    private defaultEnv: DefaultAdminNunjucksEnvironment,
  ) {}

  get adminSite() {
    return this.defaultAdminSite
  }

  get env() {
    return this.defaultEnv
  }

  async getEntityWithRelations(repository: Repository<unknown>, primaryKey: any) {
    const metadata = repository.metadata
    const relations = metadata.relations.map(r => r.propertyName)
    return (await repository.findOneOrFail(primaryKey, {
      relations,
    })) as object
  }

  async getAdminModels(query: AdminModelsQuery): Promise<AdminModelsResult> {
    // @ts-ignore
    const result: AdminModelsResult = {}
    if (query.sectionName) {
      result.section = this.adminSite.getSection(query.sectionName)
      if (query.entityName) {
        result.repository = result.section.getRepository(query.entityName)
        result.metadata = result.repository.metadata
        if (query.primaryKey) {
          result.entity = await this.getEntityWithRelations(result.repository, query.primaryKey)
        }
      }
    }
    return result
  }

  async render(name: string, context?: object) {
    const prom = new Promise((resolve, reject) => {
      this.env.env.render(name, context, function(err, res) {
        if (err) {
          reject(err)
          return err
        }
        resolve(res)
        return res
      })
    })
    const rendered = await prom
    return rendered
  }

  @Get()
  async index() {
    const sections = this.adminSite.getSectionList()
    return await this.render('index.njk', { sections })
  }

  @Get(':sectionName/:entityName')
  async changeList(@Param() params: AdminModelsQuery, @Query('page') pageParam: string = '1') {
    const { section, repository, metadata } = await this.getAdminModels(params)
    const page = parseInt(pageParam, 10)
    const [entities, count] = await repository.findAndCount(getPaginationQueryOptions(page))

    return await this.render('changelist.njk', {
      section,
      entities,
      count,
      metadata,
      page,
      resultsPerPage,
    })
  }

  @Get(':sectionName/:entityName/add')
  async add(@Param() params: AdminModelsQuery) {
    const { section, metadata } = await this.getAdminModels(params)
    return await this.render('add.njk', { section, metadata })
  }

  @Post(':sectionName/:entityName/add')
  async create(
    @Body() createEntityDto: object,
    @Param() params: AdminModelsQuery,
    @Response() response: express.Response,
  ) {
    const { section, repository, metadata } = await this.getAdminModels(params)

    // @debt architecture "This should be entirely moved to the adminSite, so that it can be overriden by the custom adminSite of a user"
    const cleanedValues = await this.adminSite.cleanValues(createEntityDto, metadata)
    const createdEntity = await repository.save(cleanedValues)

    return response.redirect(urls.changeUrl(section, metadata, createdEntity))
  }

  @Get(':sectionName/:entityName/:primaryKey/change')
  async change(@Param() params: AdminModelsQuery) {
    const { section, metadata, entity } = await this.getAdminModels(params)
    return await this.render('change.njk', { section, metadata, entity })
  }

  @Post(':sectionName/:entityName/:primaryKey/delete')
  async delete(@Param() params: AdminModelsQuery, @Response() response: express.Response) {
    const { section, repository, metadata, entity } = await this.getAdminModels(params)
    // @debt architecture "This should be entirely moved to the adminSite, so that it can be overriden by the custom adminSite of a user"
    await repository.remove(entity)
    return response.redirect(urls.changeListUrl(section, metadata))
  }

  @Post(':sectionName/:entityName/:primaryKey/change')
  async update(@Body() updateEntityDto: object, @Param() params: AdminModelsQuery) {
    const { section, repository, metadata, entity } = await this.getAdminModels(params)

    // @debt architecture "This should be entirely moved to the adminSite, so that it can be overriden by the custom adminSite of a user"
    const updatedValues = await this.adminSite.cleanValues(updateEntityDto, metadata)
    await repository.save({ ...entity, ...updatedValues })

    const updatedEntity = await this.getEntityWithRelations(repository, params.primaryKey)
    return await this.render('change.njk', { section, metadata, entity: updatedEntity })
  }
}
