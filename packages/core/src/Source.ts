import { Scene } from "./Scene";
import { OBS } from "./OBS";
import { Filter } from "./Filter";
import { SceneItem } from "./SceneItem";
import { SceneItemTransform, DeepPartial } from "./types";
import { MonitoringType } from ".";

export type SceneName = string;
export type ItemRef = string;
export type ItemID = number;

export type SourceRefs = Record<SceneName, Record<ItemRef, ItemID>>;

export type SourceFilters = Record<string, Filter>;
export type SourceSettings = Record<string, any>;

export abstract class Source<
  Settings extends SourceSettings = SourceSettings,
  Filters extends SourceFilters = SourceFilters
> {
  abstract type: string;

  _settingsType!: Settings;

  name: string;
  filters: Filters & Record<string, Filter> = {} as any;
  linked = false;

  itemInstances = new Set<SceneItem>();

  obs!: OBS;

  /**
   * Whether this source has at least one scene item in OBS
   */
  get exists() {
    return this._exists;
  }
  protected _exists = false;

  /**
   * Whether `initialize` has been called on this source yet
   */
  get initalized() {
    return this._initialized;
  }
  protected _initialized = false;

  constructor(args: {
    name: string;
    settings?: DeepPartial<Settings>;
    filters?: Filters;
  }) {
    this.name = args.name;
    this.settings = args.settings ?? ({} as DeepPartial<Settings>);
    this.filters = args.filters ?? ({} as Filters);
  }

  settings: DeepPartial<Settings>;

  async setSettings(settings: DeepPartial<Settings>) {
    await this.obs.call("SetInputSettings", {
      inputName: this.name,
      inputSettings: settings,
    });

    for (let setting in settings) {
      this.settings[setting] = settings[setting];
    }
  }

  /**
   *
   * PROPERTIES
   *
   */

  async fetchProperties() {
    const args = { inputName: this.name };
    const [
      { inputMuted },
      { inputVolumeDb, inputVolumeMul },
      { inputAudioSyncOffset },
      { monitorType },
    ] = await Promise.all([
      this.obs.call("GetInputMute", args),
      this.obs.call("GetInputVolume", args),
      this.obs.call("GetInputAudioSyncOffset", args),
      this.obs.call("GetInputAudioMonitorType", args),
    ]);

    this.muted = inputMuted;
    this.volume = {
      db: inputVolumeDb,
      mul: inputVolumeMul,
    };
    this.audioSyncOffset = inputAudioSyncOffset;
    this.audioMonitorType = monitorType as MonitoringType;
  }

  // Muted

  muted = false;

  async setMuted(muted: boolean) {
    await this.obs.call("SetInputMute", {
      inputName: this.name,
      inputMuted: muted,
    });

    this.muted = muted;
  }

  async toggleMuted() {
    const { inputMuted } = await this.obs.call("ToggleInputMute", {
      inputName: this.name,
    });

    this.muted = inputMuted;

    return inputMuted;
  }

  // Volume

  volume = {
    db: 0,
    mul: 0,
  };

  async setVolume(data: { db: number } | { mul: number }) {
    await this.obs.call("SetInputVolume", {
      inputName: this.name,
      inputVolumeDb: (data as any).db,
      inputVolumeMul: (data as any).mul,
    });

    const resp = await this.obs.call("GetInputVolume", {
      inputName: this.name,
    });

    this.volume = {
      db: resp.inputVolumeDb,
      mul: resp.inputVolumeMul,
    };
  }

  // Audio
  // Sync Offset

  audioSyncOffset = 0;

  async setAudioSyncOffset(offset: number) {
    await this.obs.call("SetInputAudioSyncOffset", {
      inputName: this.name,
      inputAudioSyncOffset: offset,
    });

    this.audioSyncOffset = offset;
  }

  // Monitoring Type

  audioMonitorType = MonitoringType.None;

  async setAudioMonitorType(type: MonitoringType) {
    await this.obs.call("SetInputAudioMonitorType", {
      inputName: this.name,
      monitorType: type,
    });

    this.audioMonitorType = type;
  }

  /**
   * Adds a filter to this source, provided that 1. The filter has not already been applied
   * to another source, and 2. The source in OBS does not have a filter with a different type
   * but the same name as the filter being added. Does not support inserting at a particular order as of yet.
   */
  // async addFilter(ref: string, filter: Filter) {
  //   if (filter.source) {
  //     throw new Error(
  //       `Filter ${this.name} has already been applied to source ${filter.source.name}`
  //     );
  //   }

  //   const exists = await this.obs
  //     .call("GetFilter",{
  //       source: this.name,
  //       filter: filter.name,
  //     })
  //     .then((i) => {
  //       if (i.type !== filter.type)
  //         throw new Error(
  //           `Filter ${this.name} already exists but has different type. Expected ${filter.type}, found ${i.type}`
  //         );
  //       return true;
  //     })
  //     .catch(() => false);

  //   filter.source = this;

  //   if (!exists)
  //     await obs.addFilterToSource({
  //       ...filter,
  //       source: this.name,
  //     });

  //   await filter.setSettings(filter.initialSettings);

  //   Object.assign(this.filters, { [ref]: filter });
  // }

  /**
   * Overridable function for creating `SceneItem` instances for a source.
   * Doesn't create any objects in OBS. Instead, creates `SceneItem` instances that can
   * override default `SceneItem` behaviours.
   *
   * @returns An instance of `SceneItem` or a class that derives it.
   */
  createItemInstance(scene: Scene, id: number, ref: string): SceneItem<this> {
    return new SceneItem(this, scene, id, ref);
  }

  /**
   * Updates the source's filters in OBS so that they match the filters defined in `this.filters`.
   * This is done by removing filters that are present on the source in OBS but not on `this`, and adding filters that are present on `this` but not on the source.
   *
   * This shouldn't be required very often, probably only on source initialization.
   */
  // async refreshFilters() {
  //   if (!this.exists) return;

  //   const { filters: sourceFilters } = await obs.getSourceFilters({
  //     source: this.name,
  //   });

  //   const filtersArray: Filter[] = Object.values(this.filters);

  //   const filtersToRemove = sourceFilters.filter((sourceFilter) =>
  //     // Only include filters where every local filter does not match
  //     filtersArray.every(
  //       (filter) =>
  //         filter.name !== sourceFilter.name ||
  //         (filter.name === sourceFilter.name &&
  //           filter.type !== sourceFilter.type)
  //     )
  //   );
  //   const filtersToAdd = filtersArray.filter((filter) =>
  //     // Only include filters where every sourceFilter is not found
  //     sourceFilters.every(
  //       (sourceFilter) =>
  //         filter.name !== sourceFilter.name ||
  //         (filter.name === sourceFilter.name &&
  //           filter.type !== sourceFilter.type)
  //     )
  //   );
  //   const filtersToUpdateSettings = filtersArray.filter((filter) =>
  //     sourceFilters.some(
  //       (sourceFilter) =>
  //         filter.name === sourceFilter.name && filter.type === sourceFilter.type
  //     )
  //   );

  //   await Promise.all([
  //     ...filtersToRemove.map(
  //       (f) =>
  //         obs.removeFilterFromSource({
  //           source: this.name,
  //           filter: f.name,
  //         }),
  //       ...filtersToAdd.map((f) =>
  //         obs.addFilterToSource({
  //           source: this.name,
  //           name: f.name,
  //           settings: f.settings,
  //           type: f.type,
  //         })
  //       ),
  //       ...filtersToUpdateSettings.map((f) =>
  //         obs.setSourceFilterSettings({
  //           filter: f.name,
  //           source: this.name,
  //           settings: f.settings,
  //         })
  //       )
  //     ),
  //   ]);

  //   await Promise.all(
  //     filtersArray.map((filter, index) =>
  //       obs.reorderSourceFilter({
  //         source: this.name,
  //         filter: filter.name,
  //         newIndex: index,
  //       })
  //     )
  //   );
  // }

  /**
   * Fetches initial data for the source.
   *
   * @returns If the source has been initialized (will always be `true`).
   * Returns true immediately if already initialized, else will return a promise that resolves
   * when initialization is finished.
   *
   * Avoiding returning a promise where possible allows for tighter batching of obs requests that
   * happen in the same tick.
   *
   * @internal
   *
   */
  async initialize(obs: OBS) {
    if (this.initalized) return;

    this.obs = obs;

    try {
      const { inputSettings, inputKind } = await this.obs.call(
        "GetInputSettings",
        {
          inputName: this.name,
        }
      );
      // Exit if source exists but type doesn't match
      if (inputKind !== this.type) throw ["WRONG_KIND", inputKind];

      // Assign refs from previous runs of code
      if (inputSettings.SIMPLE_OBS_REFS)
        this.refs = inputSettings.SIMPLE_OBS_REFS as any;

      await this.saveRefs();

      this.obs.inputs.set(this.name, this);

      this._exists = true;

      await this.initializeFilters();
    } catch (e) {
      if (Array.isArray(e) && e[0] === "WRONG_KIND")
        throw new Error(
          `Source with name ${this.name} has different type in OBS than expected. Found: ${e[1]}, Expected: ${this.type}`
        );

      this._exists = false;
    }

    this._initialized = true;
  }

  /**
   * Creates a scene item of this source in the provided scene.
   * Requires that this source has been initialized.
   * If the source already exists, a new scene item will be created.
   * If not, the source will be created and added to the scene.
   *
   * @returns A SceneItem created by `Source.createSceneItem`
   * @internal
   */
  async createItem(ref: ItemRef, scene: Scene): Promise<SceneItem<this>> {
    if (!this.initalized)
      throw new Error(
        `Cannot create item of source ${this.name} as it is not initialized`
      );

    let itemId: number;
    let transform: SceneItemTransform | null = null;

    if (this.exists) {
      // First, attempt to connect to existing scene item with provided ref
      const id = this.getRef(scene.name, ref);

      // If a ref exists, get the properties of the referenced item
      if (id !== undefined) {
        try {
          const res = await this.obs.call("GetSceneItemTransform", {
            sceneItemId: id,
            sceneName: scene.name,
          });

          transform = res.sceneItemTransform;

          itemId = id;
        } catch {
          // If the item doesn't actually exist, remove the existing ref and create a new instance of the source
          this.removeRef(scene.name, ref);

          const { sceneItemId } = await this.obs.call("CreateSceneItem", {
            sceneName: scene.name,
            sourceName: this.name,
          });

          itemId = sceneItemId;
        }
      } else {
        // If no ref exists, we could try and look for items that match the source,
        // but that would defeat the point of `obs.clean`. Instead, we create a new item
        // of the source, keeping in mind that multiple items of a source can exist at once.
        // Thus, any old items of the source will exist alongisde the newly created item,
        // ready to be removed with `obs.clean`.

        // Also, not checking if a matching item already exists saves on OBS requests :)

        const { sceneItemId } = await this.obs.call("CreateSceneItem", {
          sceneName: scene.name,
          sourceName: this.name,
        });

        itemId = sceneItemId;
      }
    } else {
      const { sceneItemId } = await this.obs.call("CreateInput", {
        inputName: this.name,
        inputKind: this.type,
        sceneName: scene.name,
        inputSettings: this.settings,
      });

      this.obs.inputs.set(this.name, this);

      this._exists = true;

      await this.initializeFilters();

      itemId = sceneItemId;
    }

    // As we have created a new scene item, set the corresponding ref.
    this.addRef(scene.name, ref, itemId);

    // Item for sure exists in OBS, so we create an instance to interact with it
    const item = this.createItemInstance(scene, itemId, ref);

    // If we found an existing item and got its properties, assign them
    if (transform !== null) item.transform = transform;

    return item;
  }

  /**
   * Uses the source's filterSchema to populate the filters property,
   * creating/linking with filters in OBS in the process.
   */
  private async initializeFilters() {
    // Create a FilterInstance for each schema item. This allows for a filter schema to be
    // used multiple times, but exist in OBS as separate objects.
    for (let ref in this.filters) {
      let filter = this.filters[ref];

      filter.source = this;
      // Necessary since this is usually done in this.addFilter(), and this.refreshFilters() operates on filter.settings
      // Could probably just do addFilter in a loop instead of all this
      filter.settings = filter.initialSettings;
    }

    // We have the FilterInstances created, so we can just refresh as normal to create them in OBS
    // await this.refreshFilters();
  }

  /**
   * Creates an instance of the source with the provided data and marks itself as existing and
   * initialized, as if the source was created by code.
   *
   * TODO: Matching settings and filters?
   *
   * @internal
   */
  linkItem(scene: Scene, id: ItemID, ref: string) {
    this.linked = true;
    this._exists = true;
    this._initialized = true;

    return this.createItemInstance(scene, id, ref);
  }

  /**
   * REFS MANAGEMENT
   *
   * Methods and state for managing refs: Data stored in OBS that
   * links scene item references in code to scene item IDs in OBS,
   * so that scene items created in code can be recovered after code restarts,
   * removing the need for all scene items to be removed and recreated to guarantee
   * consistency between code and OBS.
   */

  /**
   * Source's refs.
   * Populated from OBS once on source creation but controlled by the source from then on.
   */
  private refs: Record<SceneName, Record<ItemRef, ItemID>> = {};

  /**
   * Sends this source's refs to OBS to be saved onto the source
   *
   * @throws If saving the refs fails
   */
  protected saveRefs() {
    // This isn't await-ed since the worst thing that can happen with a failed ref is a source is deleted by obs.clean.
    // We don't really care to know when it finishes.
    return this.obs.call("SetInputSettings", {
      inputName: this.name,
      inputSettings: {
        SIMPLE_OBS_REFS: this.refs,
      },
    });
  }

  protected getRef(scene: SceneName, ref: ItemRef): ItemID | undefined {
    if (this.refs[scene]) return this.refs[scene][ref];

    return undefined;
  }

  protected addRef(scene: SceneName, ref: ItemRef, id: ItemID) {
    (this.refs[scene] ||= {})[ref] = id;

    this.saveRefs().catch((e) =>
      console.warn(`Failed to add ref ${ref} -> ${id}`, e)
    );
  }

  protected removeRef(scene: SceneName, ref: ItemRef) {
    if (!this.refs[scene]) return;

    delete this.refs[scene][ref];

    this.saveRefs().catch((e) =>
      console.warn(`Failed to remove ref ${ref}`, e)
    );
  }

  /**
   * Gathers this source's itemRefs, calculates the refs value accordingly, and forcefully
   * pushes it to the source in OBS. This method is destructive, and should only be used sparingly.
   *
   * @internal
   */
  pushRefs() {
    let refs: SourceRefs = {};

    this.itemInstances.forEach((item) => {
      (refs[item.scene.name] ||= {})[item.ref] = item.id;
    });

    this.refs = refs;

    return this.saveRefs();
  }
}