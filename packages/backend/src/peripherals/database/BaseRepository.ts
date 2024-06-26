import { Logger } from '@l2beat/backend-tools'
import { wrapAndMeasure } from '@l2beat/shared-pure'
import { Knex } from 'knex'
import { Histogram } from 'prom-client'

import { Database } from './Database'

// biome-ignore lint/complexity/noBannedTypes: we need to use these types
type IdType = number | string | String | Number

// biome-ignore lint/suspicious/noExplicitAny: generic type
type AnyMethod = (...args: any[]) => Promise<any>
// biome-ignore lint/suspicious/noExplicitAny: generic type
type AddMethod = (record: any, ...args: any[]) => Promise<IdType>
type AddManyMethod = (
  // biome-ignore lint/suspicious/noExplicitAny: generic type
  records: any[],
  // biome-ignore lint/suspicious/noExplicitAny: generic type
  ...args: any[]
) => Promise<IdType[] | number>
// biome-ignore lint/suspicious/noExplicitAny: generic type
type UpdateMethod = (record: any, ...args: any[]) => Promise<IdType>
type UpdateManyMethod = (
  // biome-ignore lint/suspicious/noExplicitAny: generic type
  records: any[],
  // biome-ignore lint/suspicious/noExplicitAny: generic type
  ...args: any[]
) => Promise<IdType[] | number>
// biome-ignore lint: generic type
type GetMethod = (...args: any[]) => Promise<{}[]>
// biome-ignore lint: generic type
type FindMethod = (...args: any[]) => Promise<{} | undefined>
// biome-ignore lint/suspicious/noExplicitAny: generic type
type DeleteMethod = (...args: any[]) => Promise<number>
// biome-ignore lint/suspicious/noExplicitAny: generic type
type SetMethod = (...args: any[]) => Promise<number>

type Keys<T, U> = Extract<keyof T, U>
type Match<T, U> = T extends U ? T : Exclude<U, T>

type AddKeys<T> = Exclude<Keys<T, `add${string}`>, AddManyKeys<T>>
type AddManyKeys<T> = Keys<T, `addMany${string}` | `add${string}Many`>
type UpdateKeys<T> = Exclude<Keys<T, `update${string}`>, UpdateManyKeys<T>>
type UpdateManyKeys<T> = Keys<T, `updateMany${string}` | `update${string}Many`>
type FindKeys<T> = Keys<T, `find${string}`>
type GetKeys<T> = Keys<T, `get${string}`>
type SetKeys<T> = Keys<T, `set${string}`>
type DeleteKeys<T> = Keys<T, `delete${string}`>

export type CheckConvention<T extends BaseRepository> = {
  [K in AddKeys<T>]: Match<T[K], AddMethod>
} & {
  [K in AddManyKeys<T>]: Match<T[K], AddManyMethod>
} & {
  [K in UpdateKeys<T>]: Match<T[K], UpdateMethod>
} & {
  [K in UpdateManyKeys<T>]: Match<T[K], UpdateManyMethod>
} & {
  [K in FindKeys<T>]: Match<T[K], FindMethod>
} & {
  [K in GetKeys<T>]: Match<T[K], GetMethod>
} & {
  [K in DeleteKeys<T>]: Match<T[K], DeleteMethod>
} & {
  [K in SetKeys<T>]: Match<T[K], SetMethod>
}

/*
  This class requires its child classes to persist given naming convention of methods and wraps them with logger and metrics.

  The CheckConvention will make sure if you are using naming convention correctly. So in the child class' constructor you should always use this.autoWrap<CheckConvention<RepositoryName>>().

  Methods that should be auto wrapped needs to start with add, addMany, find, get or delete prefix.
  If you do not want to wrap some method then you should prefix the method name with "_".
  If you do not want to use autoWrap on some method then you have to wrap it manually before calling autoWrap.

  Naming convention:
    * add... ->
      * Arguments: record that you want to add
      * Return type: IdType
    * add...Many || addMany... ->
      * Arguments: array of records that you want to add
      * Return type: array of IdType or count of added records
    * find... ->
      * Arguments: any
      * Return type: record or undefined
    * get... ->
      * Arguments: any
      * Return type: array of records
    * delete... ->
      * Arguments: any
      * Return type: count of deleted records
*/

type RepositoryHistogram = Histogram<'repository' | 'method'>
const repositoryHistogram: RepositoryHistogram = new Histogram({
  name: 'repository_method_duration_seconds',
  help: 'duration histogram of repository methods',
  labelNames: ['repository', 'method'],
})

export abstract class BaseRepository {
  protected histogram: RepositoryHistogram

  constructor(
    protected readonly database: Database,
    protected readonly logger: Logger,
  ) {
    this.logger = logger.for(this)
    this.histogram = repositoryHistogram
  }

  async runInTransaction(
    fun: (trx: Knex.Transaction) => Promise<void>,
  ): Promise<void> {
    const knex = await this.knex()
    await knex.transaction(fun)
  }

  protected knex(trx?: Knex.Transaction) {
    return this.database.getKnex(trx)
  }

  autoWrap<T>(obj: T) {
    const methodNames = Object.getOwnPropertyNames(
      Object.getPrototypeOf(obj),
    ) as unknown as (keyof T)[]

    for (const methodName of methodNames) {
      const method = obj[methodName]
      if (
        methodName === 'constructor' ||
        typeof method !== 'function' ||
        typeof methodName !== 'string' ||
        Object.prototype.hasOwnProperty.call(method, 'wrapped') ||
        methodName.startsWith('_')
      ) {
        continue
      }

      if (methodName.startsWith('get')) {
        obj[methodName] = this.wrapGet(
          method as unknown as GetMethod,
        ) as unknown as T[keyof T & string]
        continue
      }

      if (
        methodName.startsWith('addMany') ||
        (methodName.startsWith('add') && methodName.endsWith('Many'))
      ) {
        obj[methodName] = this.wrapAddMany(
          method as unknown as AddManyMethod,
        ) as unknown as T[keyof T & string]
        continue
      }

      if (methodName.startsWith('add')) {
        obj[methodName] = this.wrapAdd(
          method as unknown as AddMethod,
        ) as unknown as T[keyof T & string]
        continue
      }

      if (
        methodName.startsWith('updateMany') ||
        (methodName.startsWith('update') && methodName.endsWith('Many'))
      ) {
        obj[methodName] = this.wrapAddMany(
          method as unknown as UpdateManyMethod,
        ) as unknown as T[keyof T & string]
        continue
      }

      if (methodName.startsWith('update')) {
        obj[methodName] = this.wrapAdd(
          method as unknown as UpdateMethod,
        ) as unknown as T[keyof T & string]
        continue
      }

      if (methodName.startsWith('find')) {
        obj[methodName] = this.wrapFind(
          method as unknown as FindMethod,
        ) as unknown as T[keyof T & string]
        continue
      }

      if (methodName.startsWith('delete')) {
        obj[methodName] = this.wrapDelete(
          method as unknown as DeleteMethod,
        ) as unknown as T[keyof T & string]
        continue
      }

      if (methodName.startsWith('set')) {
        obj[methodName] = this.wrapSet(
          method as unknown as SetMethod,
        ) as unknown as T[keyof T & string]
        continue
      }

      throw new Error(
        `Wrong repository method naming convention: ${methodName}`,
      )
    }
  }

  protected wrapAny<T extends AnyMethod>(method: T): T {
    return this.wrap(method, () => this.logger.debug({ method: method.name }))
  }

  protected wrapAdd<T extends AddMethod>(method: T): T {
    return this.wrap(method, (id) =>
      this.logger.debug({ method: method.name, id: id.valueOf() }),
    )
  }

  protected wrapGet<T extends GetMethod>(method: T): T {
    return this.wrap(method, (records) =>
      this.logger.debug({
        method: method.name,
        count: Array.isArray(records) ? records.length : 1,
      }),
    )
  }

  protected wrapFind<T extends FindMethod>(method: T): T {
    return this.wrap(method, (record) =>
      this.logger.debug({ method: method.name, count: record ? 1 : 0 }),
    )
  }

  protected wrapDelete<T extends DeleteMethod>(method: T): T {
    return this.wrap(method, (count) =>
      this.logger.debug({ method: method.name, count }),
    )
  }

  protected wrapSet<T extends SetMethod>(method: T): T {
    return this.wrap(method, (count) =>
      this.logger.debug({ method: method.name, count }),
    )
  }

  protected wrapAddMany<T extends AddManyMethod>(method: T): T {
    const fn = async (records: T[], ...args: unknown[]) => {
      if (records.length === 0) {
        return []
      }
      return await method.call(this, records, ...args)
    }

    return this.wrap(fn, (result) =>
      this.logger.debug({
        method: method.name,
        count: typeof result === 'number' ? result : result.length,
      }),
    ) as T
  }

  // adds execution time tracking
  private wrap<T extends AnyMethod>(
    method: T,
    log: (result: Awaited<ReturnType<T>>) => void,
  ): T {
    const measured = wrapAndMeasure(method.bind(this), {
      histogram: this.histogram,
      labels: { repository: this.constructor.name, method: method.name },
    })
    const fn = async (...args: Parameters<T>) => {
      const result: Awaited<ReturnType<T>> = await measured(...args)
      log(result)
      return result
    }
    Object.defineProperty(fn, 'name', { value: method.name })
    Object.defineProperty(fn, 'wrapped', { value: true })
    return fn as T
  }
}
