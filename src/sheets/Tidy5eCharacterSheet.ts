import { FoundryAdapter } from '../foundry/foundry-adapter';
import CharacterSheet from './character/CharacterSheet.svelte';
import { debug, error } from 'src/utils/logging';
import { SettingsProvider, settingStore } from 'src/settings/settings';
import { initTidy5eContextMenu } from 'src/context-menu/tidy5e-context-menu';
import { CONSTANTS } from 'src/constants';
import { writable } from 'svelte/store';
import {
  type ItemCardStore,
  type CharacterSheetContext,
  type SheetStats,
  type Actor5e,
  type SheetTabCacheable,
  type SheetExpandedItemsCacheable,
  type SearchFilterCacheable,
  type LocationToSearchTextMap,
  type ExpandedItemIdToLocationsMap,
  type ExpandedItemData,
  type TidyResource,
  type MessageBusMessage,
  type MessageBus,
  type Utilities,
  type ContainerPanelItemContext,
  type ContainerCapacityContext,
  type ActorInventoryTypes,
  type CharacterItemPartitions,
  type CharacterFeatureSection,
  type CharacterItemContext,
  type SpellbookSection,
} from 'src/types/types';
import {
  applySheetAttributesToWindow,
  applyTitleToWindow,
  blurUntabbableButtonsOnClick,
  maintainCustomContentInputFocus,
} from 'src/utils/applications';
import type { SvelteComponent } from 'svelte';
import { getPercentage } from 'src/utils/numbers';
import type { Item5e, ItemChatData } from 'src/types/item.types';
import { CharacterSheetRuntime } from 'src/runtime/CharacterSheetRuntime';
import {
  actorUsesActionFeature,
  getActorActions,
} from 'src/features/actions/actions';
import { isNil } from 'src/utils/data';
import { CustomContentRenderer } from './CustomContentRenderer';
import { ActorPortraitRuntime } from 'src/runtime/ActorPortraitRuntime';
import { calculateSpellAttackAndDc } from 'src/utils/formula';
import { CustomActorTraitsRuntime } from 'src/runtime/actor-traits/CustomActorTraitsRuntime';
import { ItemTableToggleCacheService } from 'src/features/caching/ItemTableToggleCacheService';
import { ItemFilterService } from 'src/features/filtering/ItemFilterService';
import { StoreSubscriptionsService } from 'src/features/store/StoreSubscriptionsService';
import { SheetPreferencesService } from 'src/features/user-preferences/SheetPreferencesService';
import { AsyncMutex } from 'src/utils/mutex';
import type { Dnd5eActorCondition } from 'src/foundry/foundry-and-system';
import { ItemFilterRuntime } from 'src/runtime/item/ItemFilterRuntime';
import { SheetPreferencesRuntime } from 'src/runtime/user-preferences/SheetPreferencesRuntime';
import { CharacterSheetSections } from 'src/features/sections/CharacterSheetSections';

export class Tidy5eCharacterSheet
  extends dnd5e.applications.actor.ActorSheet5eCharacter
  implements
    SheetTabCacheable,
    SheetExpandedItemsCacheable,
    SearchFilterCacheable
{
  context = writable<CharacterSheetContext>();
  stats = writable<SheetStats>({
    lastSubmissionTime: null,
  });
  card = writable<ItemCardStore>();
  currentTabId: string;
  searchFilters: LocationToSearchTextMap = new Map<string, string>();
  expandedItems: ExpandedItemIdToLocationsMap = new Map<string, Set<string>>();
  expandedItemData: ExpandedItemData = new Map<string, ItemChatData>();
  itemTableTogglesCache: ItemTableToggleCacheService;
  itemFilterService: ItemFilterService;
  subscriptionsService: StoreSubscriptionsService;
  messageBus: MessageBus = writable<MessageBusMessage | undefined>();

  constructor(...args: any[]) {
    super(...args);

    this.subscriptionsService = new StoreSubscriptionsService();

    this.itemTableTogglesCache = new ItemTableToggleCacheService({
      userId: game.user.id,
      documentId: this.actor.id,
    });

    this.itemFilterService = new ItemFilterService({}, this.actor);

    this.currentTabId =
      SettingsProvider.settings.initialCharacterSheetTab.get();
  }

  get template() {
    return FoundryAdapter.getTemplate('empty-form-template.hbs');
  }

  static get defaultOptions() {
    return FoundryAdapter.mergeObject(super.defaultOptions, {
      classes: [
        'tidy5e-sheet',
        'sheet',
        'actor',
        CONSTANTS.SHEET_TYPE_CHARACTER,
      ],
      width: 740,
      height: 810,
      scrollY: ['[data-tidy-track-scroll-y]', '.scroll-container'],
    });
  }

  component: SvelteComponent | undefined;
  activateListeners(html: { get: (index: 0) => HTMLElement }) {
    let first = true;
    this.subscriptionsService.registerSubscriptions(
      this.itemFilterService.filterData$.subscribe(() => {
        if (first) return;
        this.render();
      }),
      settingStore.subscribe(() => {
        if (first) return;
        this.render();
      }),
      this.messageBus.subscribe((m) => {
        debug('Message bus message received', {
          app: this,
          actor: this.actor,
          message: m,
        });
      }),
      SheetPreferencesRuntime.getStore().subscribe(() => {
        if (first) return;
        this.render();
      })
    );
    first = false;

    const node = html.get(0);
    this.card.set({ sheet: node, item: null, itemCardContentTemplate: null });

    this.component = new CharacterSheet({
      target: node,
      context: new Map<any, any>([
        ['context', this.context],
        ['messageBus', this.messageBus],
        ['stats', this.stats],
        ['card', this.card],
        ['currentTabId', this.currentTabId],
        ['onTabSelected', this.onTabSelected.bind(this)],
        ['searchFilters', new Map(this.searchFilters)],
        [
          'onFilter',
          this.itemFilterService.onFilter.bind(this.itemFilterService),
        ],
        [
          'onFilterClearAll',
          this.itemFilterService.onFilterClearAll.bind(this.itemFilterService),
        ],
        ['onSearch', this.onSearch.bind(this)],
        ['onItemToggled', this.onItemToggled.bind(this)],
        [
          'itemTableToggles',
          new Map(this.itemTableTogglesCache.itemTableToggles),
        ],
        [
          'onItemTableToggle',
          this.itemTableTogglesCache.onItemTableToggle.bind(
            this.itemTableTogglesCache
          ),
        ],
        ['location', ''],
        ['expandedItems', new Map(this.expandedItems)],
        ['expandedItemData', new Map(this.expandedItemData)],
      ]),
    });

    initTidy5eContextMenu(this, html);
  }

  async getData(options = {}) {
    const defaultDocumentContext = await super.getData(this.options);

    const characterPreferences = SheetPreferencesService.getByType(
      this.actor.type
    );

    const inventorySortMode =
      characterPreferences.tabs?.[CONSTANTS.TAB_CHARACTER_INVENTORY]?.sort ??
      'm';
    const spellbookSortMode =
      characterPreferences.tabs?.[CONSTANTS.TAB_CHARACTER_SPELLBOOK]?.sort ??
      'm';
    const featureSortMode =
      characterPreferences.tabs?.[CONSTANTS.TAB_CHARACTER_FEATURES]?.sort ??
      'm';
    const actionListSortMode =
      characterPreferences.tabs?.[CONSTANTS.TAB_ACTOR_ACTIONS]?.sort ?? 'm';

    const unlocked =
      FoundryAdapter.isActorSheetUnlocked(this.actor) &&
      defaultDocumentContext.editable;

    const tidyResources: TidyResource[] = defaultDocumentContext.resources.map(
      (r: any) => ({
        name: r.name,
        label: r.label,
        labelName: `system.resources.${r.name}.label`,
        placeholder: r.placeholder,
        value: r.value,
        valueName: `system.resources.${r.name}.value`,
        max: r.max,
        maxName: `system.resources.${r.name}.max`,
        sr: r.sr,
        srName: `system.resources.${r.name}.sr`,
        lr: r.lr,
        lrName: `system.resources.${r.name}.lr`,
        cssClasses: [],
        dataSet: {},
      })
    );

    Hooks.callAll(
      CONSTANTS.HOOK_TIDY5E_SHEETS_PREPARE_RESOURCES,
      tidyResources,
      this.actor
    );

    let maxPreparedSpellsTotal = 0;
    try {
      const formula =
        FoundryAdapter.tryGetFlag(
          this.actor,
          'maxPreparedSpells'
        )?.toString() ?? '';

      if (formula?.trim() !== '') {
        const roll = await Roll.create(
          formula,
          this.actor.getRollData()
        ).evaluate({ async: true });
        maxPreparedSpellsTotal = roll.total;
      }
    } catch (e) {
      error('Unable to calculate max prepared spells', false, e);
    }

    // TODO: Make a builder for this
    // TODO: Extract to runtime?
    let utilities: Utilities = {
      [CONSTANTS.TAB_CHARACTER_INVENTORY]: {
        utilityToolbarCommands: [
          {
            title: FoundryAdapter.localize('SIDEBAR.SortModeAlpha'),
            iconClass: 'fa-solid fa-arrow-down-a-z fa-fw',
            execute: async () => {
              await SheetPreferencesService.setDocumentTypeTabPreference(
                this.actor.type,
                CONSTANTS.TAB_CHARACTER_INVENTORY,
                'sort',
                'm'
              );
            },
            visible: inventorySortMode === 'a',
          },
          {
            title: FoundryAdapter.localize('SIDEBAR.SortModeManual'),
            iconClass: 'fa-solid fa-arrow-down-short-wide fa-fw',
            execute: async () => {
              await SheetPreferencesService.setDocumentTypeTabPreference(
                this.actor.type,
                CONSTANTS.TAB_CHARACTER_INVENTORY,
                'sort',
                'a'
              );
            },
            visible: inventorySortMode === 'm',
          },
          {
            title: FoundryAdapter.localize(
              'TIDY5E.Commands.HideContainerPanel'
            ),
            iconClass: `fas fa-boxes-stacked fa-fw`,
            execute: () => {
              FoundryAdapter.unsetFlag(this.actor, 'showContainerPanel');
            },
            visible: !!FoundryAdapter.tryGetFlag(
              this.actor,
              'showContainerPanel'
            ),
          },
          {
            title: FoundryAdapter.localize(
              'TIDY5E.Commands.ShowContainerPanel'
            ),
            iconClass: `fas fa-box fa-fw`,
            execute: () => {
              FoundryAdapter.setFlag(this.actor, 'showContainerPanel', true);
            },
            visible: !FoundryAdapter.tryGetFlag(
              this.actor,
              'showContainerPanel'
            ),
          },
          {
            title: FoundryAdapter.localize('TIDY5E.Commands.ExpandAll'),
            iconClass: 'fas fa-angles-down',
            execute: () =>
              // TODO: Use app.messageBus
              this.messageBus.set({
                tabId: CONSTANTS.TAB_CHARACTER_INVENTORY,
                message: CONSTANTS.MESSAGE_BUS_EXPAND_ALL,
              }),
          },
          {
            title: FoundryAdapter.localize('TIDY5E.Commands.CollapseAll'),
            iconClass: 'fas fa-angles-up',
            execute: () =>
              // TODO: Use app.messageBus
              this.messageBus.set({
                tabId: CONSTANTS.TAB_CHARACTER_INVENTORY,
                message: CONSTANTS.MESSAGE_BUS_COLLAPSE_ALL,
              }),
          },
          {
            title: FoundryAdapter.localize('TIDY5E.ListLayout'),
            iconClass: 'fas fa-th-list fa-fw toggle-list',
            visible: !FoundryAdapter.tryGetFlag(this.actor, 'inventory-grid'),
            execute: () => {
              FoundryAdapter.setFlag(this.actor, 'inventory-grid', true);
            },
          },
          {
            title: FoundryAdapter.localize('TIDY5E.GridLayout'),
            iconClass: 'fas fa-th-large fa-fw toggle-grid',
            visible: !!FoundryAdapter.tryGetFlag(this.actor, 'inventory-grid'),
            execute: () => {
              FoundryAdapter.unsetFlag(this.actor, 'inventory-grid');
            },
          },
        ],
      },
      [CONSTANTS.TAB_CHARACTER_SPELLBOOK]: {
        utilityToolbarCommands: [
          {
            title: FoundryAdapter.localize('SIDEBAR.SortModeAlpha'),
            iconClass: 'fa-solid fa-arrow-down-a-z fa-fw',
            execute: async () => {
              await SheetPreferencesService.setDocumentTypeTabPreference(
                this.actor.type,
                CONSTANTS.TAB_CHARACTER_SPELLBOOK,
                'sort',
                'm'
              );
            },
            visible: spellbookSortMode === 'a',
          },
          {
            title: FoundryAdapter.localize('SIDEBAR.SortModeManual'),
            iconClass: 'fa-solid fa-arrow-down-short-wide fa-fw',
            execute: async () => {
              await SheetPreferencesService.setDocumentTypeTabPreference(
                this.actor.type,
                CONSTANTS.TAB_CHARACTER_SPELLBOOK,
                'sort',
                'a'
              );
            },
            visible: spellbookSortMode === 'm',
          },
          {
            title: 'Spell Pips',
            iconClass: 'fa-regular fa-circle-dot fa-fw',
            execute: async () => {
              await SheetPreferencesService.setDocumentTypePreference(
                this.actor.type,
                CONSTANTS.SPELL_SLOT_TRACKER_MODE_PREFERENCE,
                CONSTANTS.SPELL_SLOT_TRACKER_MODE_VALUE_MAX
              );
            },
            visible:
              (characterPreferences?.spellSlotTrackerMode ??
                CONSTANTS.SPELL_SLOT_TRACKER_MODE_PIPS) ===
              CONSTANTS.SPELL_SLOT_TRACKER_MODE_PIPS,
          },
          {
            title: 'Spell Value/Max',
            iconClass: 'fa-regular fa-square fa-fw',
            execute: async () => {
              await SheetPreferencesService.setDocumentTypePreference(
                this.actor.type,
                CONSTANTS.SPELL_SLOT_TRACKER_MODE_PREFERENCE,
                CONSTANTS.SPELL_SLOT_TRACKER_MODE_PIPS
              );
            },
            visible:
              characterPreferences?.spellSlotTrackerMode ===
              CONSTANTS.SPELL_SLOT_TRACKER_MODE_VALUE_MAX,
          },
          {
            title: FoundryAdapter.localize('TIDY5E.Commands.ExpandAll'),
            iconClass: 'fas fa-angles-down',
            execute: () =>
              // TODO: Use app.messageBus
              this.messageBus.set({
                tabId: CONSTANTS.TAB_CHARACTER_SPELLBOOK,
                message: CONSTANTS.MESSAGE_BUS_EXPAND_ALL,
              }),
          },
          {
            title: FoundryAdapter.localize('TIDY5E.Commands.CollapseAll'),
            iconClass: 'fas fa-angles-up',
            execute: () =>
              // TODO: Use app.messageBus
              this.messageBus.set({
                tabId: CONSTANTS.TAB_CHARACTER_SPELLBOOK,
                message: CONSTANTS.MESSAGE_BUS_COLLAPSE_ALL,
              }),
          },
          {
            title: FoundryAdapter.localize('TIDY5E.ListLayout'),
            iconClass: 'fas fa-th-list fa-fw toggle-list',
            visible: !FoundryAdapter.tryGetFlag(this.actor, 'spellbook-grid'),
            execute: () => {
              FoundryAdapter.setFlag(this.actor, 'spellbook-grid', true);
            },
          },
          {
            title: FoundryAdapter.localize('TIDY5E.GridLayout'),
            iconClass: 'fas fa-th-large fa-fw toggle-grid',
            visible: !!FoundryAdapter.tryGetFlag(this.actor, 'spellbook-grid'),
            execute: () => {
              FoundryAdapter.unsetFlag(this.actor, 'spellbook-grid');
            },
          },
        ],
      },
      [CONSTANTS.TAB_CHARACTER_FEATURES]: {
        utilityToolbarCommands: [
          {
            title: FoundryAdapter.localize('SIDEBAR.SortModeAlpha'),
            iconClass: 'fa-solid fa-arrow-down-a-z fa-fw',
            execute: async () => {
              await SheetPreferencesService.setDocumentTypeTabPreference(
                this.actor.type,
                CONSTANTS.TAB_CHARACTER_FEATURES,
                'sort',
                'm'
              );
            },
            visible: featureSortMode === 'a',
          },
          {
            title: FoundryAdapter.localize('SIDEBAR.SortModeManual'),
            iconClass: 'fa-solid fa-arrow-down-short-wide fa-fw',
            execute: async () => {
              await SheetPreferencesService.setDocumentTypeTabPreference(
                this.actor.type,
                CONSTANTS.TAB_CHARACTER_FEATURES,
                'sort',
                'a'
              );
            },
            visible: featureSortMode === 'm',
          },
          {
            title: FoundryAdapter.localize('TIDY5E.Commands.ExpandAll'),
            iconClass: 'fas fa-angles-down',
            execute: () =>
              // TODO: Use app.messageBus
              this.messageBus.set({
                tabId: CONSTANTS.TAB_CHARACTER_FEATURES,
                message: CONSTANTS.MESSAGE_BUS_EXPAND_ALL,
              }),
          },
          {
            title: FoundryAdapter.localize('TIDY5E.Commands.CollapseAll'),
            iconClass: 'fas fa-angles-up',
            execute: () =>
              // TODO: Use app.messageBus
              this.messageBus.set({
                tabId: CONSTANTS.TAB_CHARACTER_FEATURES,
                message: CONSTANTS.MESSAGE_BUS_COLLAPSE_ALL,
              }),
          },
        ],
      },
      [CONSTANTS.TAB_ACTOR_ACTIONS]: {
        utilityToolbarCommands: [
          {
            title: FoundryAdapter.localize('SIDEBAR.SortModeAlpha'),
            iconClass: 'fa-solid fa-arrow-down-a-z fa-fw',
            execute: async () => {
              await SheetPreferencesService.setDocumentTypeTabPreference(
                this.actor.type,
                CONSTANTS.TAB_ACTOR_ACTIONS,
                'sort',
                'm'
              );
            },
            visible: actionListSortMode === 'a',
          },
          {
            title: FoundryAdapter.localize('TIDY5E.SortMode.ActionListDefault'),
            iconClass: 'fa-solid fa-arrow-down-short-wide fa-fw',
            execute: async () => {
              await SheetPreferencesService.setDocumentTypeTabPreference(
                this.actor.type,
                CONSTANTS.TAB_ACTOR_ACTIONS,
                'sort',
                'a'
              );
            },
            visible: actionListSortMode === 'm',
          },
          {
            title: FoundryAdapter.localize('TIDY5E.Commands.ExpandAll'),
            iconClass: 'fas fa-angles-down',
            execute: () =>
              // TODO: Use app.messageBus
              this.messageBus.set({
                tabId: CONSTANTS.TAB_ACTOR_ACTIONS,
                message: CONSTANTS.MESSAGE_BUS_EXPAND_ALL,
              }),
          },
          {
            title: FoundryAdapter.localize('TIDY5E.Commands.CollapseAll'),
            iconClass: 'fas fa-angles-up',
            execute: () =>
              // TODO: Use app.messageBus
              this.messageBus.set({
                tabId: CONSTANTS.TAB_ACTOR_ACTIONS,
                message: CONSTANTS.MESSAGE_BUS_COLLAPSE_ALL,
              }),
          },
        ],
      },
    };

    // Effects & Conditions
    const conditionIds = new Set();
    const conditions = Object.entries<any>(CONFIG.DND5E.conditionTypes).reduce<
      Dnd5eActorCondition[]
    >((arr, [k, c]) => {
      if (k === 'diseased') return arr; // Filter out diseased as it's not a real condition.
      const { label: name, icon, reference } = c;
      const id = dnd5e.utils.staticID(`dnd5e${k}`);
      conditionIds.add(id);
      const existing = this.actor.effects.get(id);
      const { disabled, img } = existing ?? {};
      arr.push({
        name,
        reference,
        id: k,
        icon: img ?? icon,
        disabled: existing ? disabled : !this.actor.statuses.has(k),
      });
      return arr;
    }, []);

    for (const category of Object.values(
      defaultDocumentContext.effects as any[]
    )) {
      category.effects = await category.effects.reduce(
        async (arr: any[], effect: any) => {
          effect.updateDuration();
          if (conditionIds.has(effect.id) && !effect.duration.remaining)
            return arr;
          const { id, name, img, disabled, duration } = effect;
          let source = await effect.getSource();
          // If the source is an ActiveEffect from another Actor, note the source as that Actor instead.
          if (
            source instanceof dnd5e.documents.ActiveEffect5e &&
            source.target !== this.object
          ) {
            source = source.target;
          }
          arr = await arr;
          arr.push({
            id,
            name,
            img,
            disabled,
            duration,
            source,
            parentId: effect.target === effect.parent ? null : effect.parent.id,
            durationParts: duration.remaining ? duration.label.split(', ') : [],
            hasTooltip: source instanceof dnd5e.documents.Item5e,
          });
          return arr;
        },
        []
      );
    }

    let containerPanelItems: ContainerPanelItemContext[] = [];
    try {
      let containers = Array.from<Item5e>(this.actor.items.values())
        .filter(
          (i: Item5e) =>
            i.type === CONSTANTS.ITEM_TYPE_CONTAINER &&
            !this.actor.items.has(i.system.container)
        )
        .toSorted((a: Item5e, b: Item5e) => a.sort - b.sort);

      for (let container of containers) {
        const capacity =
          (await container.system.computeCapacity()) as ContainerCapacityContext;
        containerPanelItems.push({
          container,
          ...capacity,
        });
      }
    } catch (e) {
      error(
        'An error occurred while preparing containers for the container panel',
        false,
        e
      );
    }

    const context: CharacterSheetContext = {
      ...defaultDocumentContext,
      activateEditors: (node, options) =>
        FoundryAdapter.activateEditors(node, this, options?.bindSecrets),
      actions: getActorActions(this.actor, this.itemFilterService),
      actorClassesToImages: getActorClassesToImages(this.actor),
      actorPortraitCommands:
        ActorPortraitRuntime.getEnabledPortraitMenuCommands(this.actor),
      allowEffectsManagement: FoundryAdapter.allowCharacterEffectsManagement(
        this.actor
      ),
      allowMaxHpOverride:
        SettingsProvider.settings.allowHpMaxOverride.get() &&
        (!SettingsProvider.settings.lockHpMaxChanges.get() ||
          FoundryAdapter.userIsGm()),
      appearanceEnrichedHtml: await FoundryAdapter.enrichHtml(
        this.actor.system.details.appearance,
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      appId: this.appId,
      biographyEnrichedHtml: await FoundryAdapter.enrichHtml(
        this.actor.system.details.biography.value,
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      bondEnrichedHtml: await FoundryAdapter.enrichHtml(
        this.actor.system.details.bond,
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      conditions: conditions,
      containerPanelItems: containerPanelItems,
      customActorTraits: CustomActorTraitsRuntime.getEnabledTraits(
        defaultDocumentContext
      ),
      customContent: await CharacterSheetRuntime.getContent(
        defaultDocumentContext
      ),
      editable: defaultDocumentContext.editable,
      filterData: this.itemFilterService.getDocumentItemFilterData(),
      filterPins: ItemFilterRuntime.defaultFilterPins[this.actor.type],
      flawEnrichedHtml: await FoundryAdapter.enrichHtml(
        this.actor.system.details.flaw,
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      healthPercentage: getPercentage(
        this.actor?.system?.attributes?.hp?.value,
        this.actor?.system?.attributes?.hp?.max
      ),
      idealEnrichedHtml: await FoundryAdapter.enrichHtml(
        this.actor.system.details.ideal,
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      lockExpChanges: FoundryAdapter.shouldLockExpChanges(),
      lockHpMaxChanges: FoundryAdapter.shouldLockHpMaxChanges(),
      lockItemQuantity: FoundryAdapter.shouldLockItemQuantity(),
      lockLevelSelector: FoundryAdapter.shouldLockLevelSelector(),
      lockMoneyChanges: FoundryAdapter.shouldLockMoneyChanges(),
      lockSensitiveFields:
        (!unlocked && SettingsProvider.settings.useTotalSheetLock.get()) ||
        !defaultDocumentContext.editable,
      maxPreparedSpellsTotal,
      notes1EnrichedHtml: await FoundryAdapter.enrichHtml(
        FoundryAdapter.getProperty<string>(
          this.actor,
          `flags.${CONSTANTS.MODULE_ID}.notes1.value`
        ) ?? '',
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      notes2EnrichedHtml: await FoundryAdapter.enrichHtml(
        FoundryAdapter.getProperty<string>(
          this.actor,
          `flags.${CONSTANTS.MODULE_ID}.notes2.value`
        ) ?? '',
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      notes3EnrichedHtml: await FoundryAdapter.enrichHtml(
        FoundryAdapter.getProperty<string>(
          this.actor,
          `flags.${CONSTANTS.MODULE_ID}.notes3.value`
        ) ?? '',
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      notes4EnrichedHtml: await FoundryAdapter.enrichHtml(
        FoundryAdapter.getProperty<string>(
          this.actor,
          `flags.${CONSTANTS.MODULE_ID}.notes4.value`
        ) ?? '',
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      notesEnrichedHtml: await FoundryAdapter.enrichHtml(
        FoundryAdapter.getProperty<string>(
          this.actor,
          `flags.${CONSTANTS.MODULE_ID}.notes.value`
        ) ?? '',
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      originalContext: defaultDocumentContext,
      owner: this.actor.isOwner,
      showContainerPanel:
        FoundryAdapter.tryGetFlag(this.actor, 'showContainerPanel') === true &&
        Array.from(this.actor.items).some(
          (i: Item5e) => i.type === CONSTANTS.ITEM_TYPE_CONTAINER
        ),
      showLimitedSheet: FoundryAdapter.showLimitedSheet(this.actor),
      spellCalculations: calculateSpellAttackAndDc(this.actor),
      spellSlotTrackerMode:
        characterPreferences.spellSlotTrackerMode ??
        CONSTANTS.SPELL_SLOT_TRACKER_MODE_PIPS,
      tabs: [],
      tidyResources: tidyResources,
      traitEnrichedHtml: await FoundryAdapter.enrichHtml(
        this.actor.system.details.trait,
        {
          secrets: this.actor.isOwner,
          rollData: defaultDocumentContext.rollData,
          async: true,
          relativeTo: this.actor,
        }
      ),
      unlocked: unlocked,
      useActionsFeature: actorUsesActionFeature(this.actor),
      useClassicControls:
        SettingsProvider.settings.useClassicControlsForCharacter.get(),
      useRoundedPortraitStyle: [
        CONSTANTS.CIRCULAR_PORTRAIT_OPTION_ALL as string,
        CONSTANTS.CIRCULAR_PORTRAIT_OPTION_CHARACTER as string,
      ].includes(SettingsProvider.settings.useCircularPortraitStyle.get()),
      utilities: utilities,
      viewableWarnings:
        defaultDocumentContext.warnings?.filter(
          (w: any) => !isNil(w.message?.trim(), '')
        ) ?? [],
    };

    let tabs = await CharacterSheetRuntime.getTabs(context);

    const selectedTabs = FoundryAdapter.tryGetFlag<string[]>(
      context.actor,
      'selected-tabs'
    );

    if (selectedTabs?.length) {
      tabs = tabs
        .filter((t) => selectedTabs?.includes(t.id))
        .sort(
          (a, b) => selectedTabs.indexOf(a.id) - selectedTabs.indexOf(b.id)
        );
    } else {
      const defaultTabs =
        SettingsProvider.settings.defaultCharacterSheetTabs.get();
      tabs = tabs
        .filter((t) => defaultTabs?.includes(t.id))
        .sort((a, b) => defaultTabs.indexOf(a.id) - defaultTabs.indexOf(b.id));
    }

    context.tabs = tabs;

    debug('Character Sheet context data', context);

    return context;
  }

  protected _prepareItems(context: CharacterSheetContext) {
    // Categorize items as inventory, spellbook, features, and classes
    const inventory: ActorInventoryTypes = {};
    const favoriteInventory: ActorInventoryTypes = {};
    for (const type of CharacterSheetSections.inventoryItemTypes) {
      inventory[type] = {
        label: `${CONFIG.Item.typeLabels[type]}Pl`,
        items: [],
        dataset: { type },
        canCreate: true,
      };
      favoriteInventory[type] = {
        label: `${CONFIG.Item.typeLabels[type]}Pl`,
        items: [],
        dataset: { type },
        canCreate: false,
      };
    }

    // Partition items by category
    let {
      items,
      spells,
      feats,
      races,
      backgrounds,
      classes,
      subclasses,
      favorites,
    } = Array.from(this.actor.items)
      .toSorted((a: Item5e, b: Item5e) => (a.sort || 0) - (b.sort || 0))
      .reduce(
        (
          obj: CharacterItemPartitions & { favorites: CharacterItemPartitions },
          item: Item5e
        ) => {
          const { quantity, uses, recharge } = item.system;

          // Item details
          const ctx = (context.itemContext[item.id] ??= {});
          ctx.isStack = Number.isNumeric(quantity) && quantity !== 1;
          ctx.attunement = FoundryAdapter.getAttunementContext(item);

          // Item usage
          ctx.hasUses = item.hasLimitedUses;
          ctx.isOnCooldown =
            recharge && !!recharge.value && recharge.charged === false;
          ctx.isDepleted = ctx.isOnCooldown && ctx.hasUses && uses.value > 0;
          ctx.hasTarget = item.hasAreaTarget || item.hasIndividualTarget;

          // Unidentified items
          ctx.concealDetails =
            !game.user.isGM && item.system.identified === false;

          // Item grouping
          const [originId] =
            item.getFlag('dnd5e', 'advancementOrigin')?.split('.') ?? [];
          const group = this.actor.items.get(originId);
          switch (group?.type) {
            case 'race':
              ctx.group = 'race';
              break;
            case 'background':
              ctx.group = 'background';
              break;
            case 'class':
              ctx.group = group.identifier;
              break;
            case 'subclass':
              ctx.group = group.class?.identifier ?? 'other';
              break;
            default:
              ctx.group = 'other';
          }

          // Individual item preparation
          this._prepareItem(item, ctx);

          const isWithinContainer = this.actor.items.has(item.system.container);
          // Classify items into types
          if (!isWithinContainer) {
            this._partitionItem(item, obj, inventory);
          }

          if (FoundryAdapter.isDocumentFavorited(item)) {
            this._partitionItem(item, obj.favorites, favoriteInventory);
          }

          return obj;
        },
        {
          items: [] as Item5e[],
          spells: [] as Item5e[],
          feats: [] as Item5e[],
          races: [] as Item5e[],
          backgrounds: [] as Item5e[],
          classes: [] as Item5e[],
          subclasses: [] as Item5e[],
          favorites: {
            items: [] as Item5e[],
            spells: [] as Item5e[],
            feats: [] as Item5e[],
            races: [] as Item5e[],
            backgrounds: [] as Item5e[],
            classes: [] as Item5e[],
            subclasses: [] as Item5e[],
          },
        }
      );

    const characterPreferences = SheetPreferencesService.getByType(
      this.actor.type
    );

    // Organize items
    // Filter items
    items = this.itemFilterService.filter(
      items,
      CONSTANTS.TAB_CHARACTER_INVENTORY
    );

    // Sort items
    const inventorySortMode =
      characterPreferences.tabs?.[CONSTANTS.TAB_CHARACTER_INVENTORY]?.sort ??
      'm';

    if (inventorySortMode === 'a') {
      items = items.toSorted((a, b) => a.name.localeCompare(b.name));
    }

    // Section the items by type
    // TODO: Intercept with CCSS feature set
    for (let i of items) {
      const ctx = (context.itemContext[i.id] ??= {});
      ctx.totalWeight = i.system.totalWeight?.toNearest(0.1);
      inventory[i.type].items.push(i);
    }

    for (let i of favorites.items) {
      const ctx = (context.itemContext[i.id] ??= {});
      ctx.totalWeight = i.system.totalWeight?.toNearest(0.1);
      favoriteInventory[i.type].items.push(i);
    }

    // Organize Spellbook and count the number of prepared spells (excluding always, at will, cantrips, etc...)
    // Count prepared spells
    const nPrepared = spells.filter((spell) => {
      const prep = spell.system.preparation;
      return (
        spell.system.level > 0 && prep.mode === 'prepared' && prep.prepared
      );
    }).length;

    // Filter spells
    spells = this.itemFilterService.filter(
      spells,
      CONSTANTS.TAB_CHARACTER_SPELLBOOK
    );

    // Sort spells
    const spellbookSortMode =
      characterPreferences.tabs?.[CONSTANTS.TAB_CHARACTER_SPELLBOOK]?.sort ??
      'm';

    if (spellbookSortMode === 'a') {
      spells = spells.toSorted((a, b) => a.name.localeCompare(b.name));
    }

    // Section spells
    // TODO: Intercept with CCSS feature set
    const spellbook = this._prepareSpellbook(context, spells);
    const favoriteSpellbook = this._prepareSpellbook(context, favorites.spells);

    // Organize Features
    // Sub-item groupings and validation
    // Classes: Interleave matching subclasses
    classes = this._correlateClassesAndSubclasses(context, classes, subclasses);

    // Put unmatched subclasses into features so they don't disappear
    for (const subclass of subclasses) {
      feats.push(subclass);
      const message = game.i18n.format('DND5E.SubclassMismatchWarn', {
        name: subclass.name,
        class: subclass.system.classIdentifier,
      });
      context.warnings.push({ message, type: 'warning' });
    }

    favorites.classes = this._correlateClassesAndSubclasses(
      context,
      favorites.classes,
      favorites.subclasses
    );

    for (const subclass of favorites.subclasses) {
      favorites.classes.push(subclass);
    }

    // Filter Features
    races = this.itemFilterService.filter(
      races,
      CONSTANTS.TAB_CHARACTER_FEATURES
    );
    classes = this.itemFilterService.filter(
      classes,
      CONSTANTS.TAB_CHARACTER_FEATURES
    );
    feats = this.itemFilterService.filter(
      feats,
      CONSTANTS.TAB_CHARACTER_FEATURES
    );
    backgrounds = this.itemFilterService.filter(
      backgrounds,
      CONSTANTS.TAB_CHARACTER_FEATURES
    );

    // Sort Features
    const featureSortMode =
      characterPreferences.tabs?.[CONSTANTS.TAB_CHARACTER_FEATURES]?.sort ??
      'm';

    if (featureSortMode === 'a') {
      // Classes optionally have correlated subclasses adjacent to them; re-apply their subclasses after sorting them
      classes = classes
        .filter((f) => f.type === CONSTANTS.ITEM_TYPE_CLASS)
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .reduce((prev, classItem) => {
          prev.push(classItem);
          const subclass = classes.find(
            (f) =>
              f.type === CONSTANTS.ITEM_TYPE_SUBCLASS &&
              f.system.classIdentifier === classItem.system.identifier
          );
          if (subclass) {
            prev.push(subclass);
          }
          return prev;
        }, []);
      races = races.toSorted((a, b) => a.name.localeCompare(b.name));
      feats = feats.toSorted((a, b) => a.name.localeCompare(b.name));
      backgrounds = backgrounds.toSorted((a, b) =>
        a.name.localeCompare(b.name)
      );
    } else if (featureSortMode === 'm') {
      classes = classes.toSorted((a, b) => b.system.levels - a.system.levels);
    }

    // Section features
    // TODO: Intercept with CCSS feature set
    const features: Record<string, CharacterFeatureSection> =
      this._buildFeaturesSections(races, backgrounds, classes, feats);

    const favoriteFeatures: Record<string, CharacterFeatureSection> =
      this._buildFeaturesSections(
        favorites.races,
        favorites.backgrounds,
        favorites.classes,
        favorites.feats
      );

    // Assign and return
    context.inventory = Object.values(inventory);
    context.spellbook = spellbook;
    context.preparedSpells = nPrepared;
    context.features = Object.values(features);
    context.favorites = [
      ...Object.values(favoriteInventory)
        .filter((i) => i.items.length)
        .map((i) => ({
          ...i,
          type: CONSTANTS.TAB_CHARACTER_INVENTORY,
        })),
      ...Object.values(favoriteFeatures)
        .filter((i) => i.items.length)
        .map((i) => ({
          ...i,
          type: CONSTANTS.TAB_CHARACTER_FEATURES,
        })),
      ...favoriteSpellbook
        .filter((s: SpellbookSection) => s.spells.length)
        .map((s: SpellbookSection) => ({
          ...s,
          type: CONSTANTS.TAB_CHARACTER_SPELLBOOK,
        })),
    ];
  }

  // TODO: Consider moving to the static class CharacterSheetSections
  private _buildFeaturesSections(
    races: any[],
    backgrounds: any[],
    classes: any[],
    feats: any[]
  ): Record<string, CharacterFeatureSection> {
    return {
      race: {
        label: CONFIG.Item.typeLabels.race,
        items: races,
        hasActions: false,
        dataset: { type: 'race' },
        showRequirementsColumn: true,
      },
      background: {
        label: CONFIG.Item.typeLabels.background,
        items: backgrounds,
        hasActions: false,
        dataset: { type: 'background' },
        showRequirementsColumn: true,
      },
      classes: {
        label: `${CONFIG.Item.typeLabels.class}Pl`,
        items: classes,
        hasActions: false,
        dataset: { type: 'class' },
        isClass: true,
        showLevelColumn: true,
      },
      active: {
        label: 'DND5E.FeatureActive',
        items: feats.filter((feat) => feat.system.activation?.type),
        hasActions: true,
        dataset: { type: 'feat', 'activation.type': 'action' },
        showRequirementsColumn: true,
        showUsagesColumn: true,
        showUsesColumn: true,
      },
      passive: {
        label: 'DND5E.FeaturePassive',
        items: feats.filter((feat) => !feat.system.activation?.type),
        hasActions: false,
        dataset: { type: 'feat' },
        showRequirementsColumn: true,
      },
    };
  }

  // TODO: Consider moving to the static class CharacterSheetSections
  private _partitionItem(
    item: any,
    obj: CharacterItemPartitions,
    inventory: ActorInventoryTypes
  ) {
    if (item.type === 'spell') {
      obj.spells.push(item);
    } else if (item.type === 'feat') {
      obj.feats.push(item);
    } else if (item.type === 'race') {
      obj.races.push(item);
    } else if (item.type === 'background') {
      obj.backgrounds.push(item);
    } else if (item.type === 'class') {
      obj.classes.push(item);
    } else if (item.type === 'subclass') {
      obj.subclasses.push(item);
    } else if (Object.keys(inventory).includes(item.type)) {
      obj.items.push(item);
    }
  }

  // TODO: Consider moving to the static class CharacterSheetSections
  private _correlateClassesAndSubclasses(
    context: CharacterSheetContext,
    classes: Item5e[],
    subclasses: Item5e[]
  ) {
    const maxLevelDelta =
      CONFIG.DND5E.maxLevel - this.actor.system.details.level;
    return classes.reduce((arr, cls) => {
      const ctx = (context.itemContext[cls.id] ??= {});
      ctx.availableLevels = Array.fromRange(CONFIG.DND5E.maxLevel + 1)
        .slice(1)
        .map((level) => {
          const delta = level - cls.system.levels;
          return { level, delta, disabled: delta > maxLevelDelta };
        });
      ctx.prefixedImage = cls.img ? foundry.utils.getRoute(cls.img) : null;
      arr.push(cls);
      const identifier =
        cls.system.identifier || cls.name.slugify({ strict: true });
      const subclass = subclasses.findSplice(
        (s: Item5e) => s.system.classIdentifier === identifier
      );
      if (subclass) arr.push(subclass);
      return arr;
    }, []);
  }

  /**
   * A helper method to establish the displayed preparation state for an item.
   * @param {Item5e} item     Item being prepared for display.
   * @param {object} context  Context data for display.
   * @protected
   */
  protected _prepareItem(item: Item5e, context: CharacterItemContext) {
    if (item.type === 'spell') {
      const prep = item.system.preparation || {};
      const isAlways = prep.mode === 'always';
      const isPrepared = !!prep.prepared;
      context.toggleClass = isPrepared ? 'active' : '';
      if (isAlways) context.toggleClass = 'fixed';
      if (isAlways)
        context.toggleTitle = CONFIG.DND5E.spellPreparationModes.always;
      else if (isPrepared)
        context.toggleTitle = CONFIG.DND5E.spellPreparationModes.prepared;
      else context.toggleTitle = game.i18n.localize('DND5E.SpellUnprepared');
    } else {
      const isActive = !!item.system.equipped;
      context.toggleClass = isActive ? 'active' : '';
      context.toggleTitle = game.i18n.localize(
        isActive ? 'DND5E.Equipped' : 'DND5E.Unequipped'
      );
      context.canToggle = 'equipped' in item.system;
    }
  }

  private async setExpandedItemData() {
    this.expandedItemData.clear();
    for (const id of this.expandedItems.keys()) {
      const item = this.actor.items.get(id);
      if (item) {
        this.expandedItemData.set(
          id,
          await item.getChatData({ secrets: this.actor.isOwner })
        );
      }
    }
  }

  onToggleAbilityProficiency(event: Event) {
    return this._onToggleAbilityProficiency(event);
  }

  onShortRest(event: Event) {
    return this._onShortRest(event);
  }

  onLongRest(event: Event) {
    return this._onLongRest(event);
  }

  async _onDropSingleItem(itemData: any) {
    // Create a Consumable spell scroll on the Inventory tab
    if (
      itemData.type === 'spell' &&
      this.currentTabId === CONSTANTS.TAB_CHARACTER_INVENTORY
    ) {
      const scroll = await dnd5e.documents.Item5e.createScrollFromSpell(
        itemData
      );
      return scroll.toObject();
    }

    return super._onDropSingleItem(itemData);
  }

  close(options: unknown = {}) {
    this._destroySvelteComponent();
    this.subscriptionsService.unsubscribeAll();
    return super.close(options);
  }

  submit(): void {
    super.submit();
  }

  async _onSubmit(...args: any[]) {
    await super._onSubmit(...args);
    this.stats.update((stats) => {
      stats.lastSubmissionTime = new Date();
      return stats;
    });
  }

  private _renderMutex = new AsyncMutex();
  async _render(force?: boolean, options = {}) {
    await this._renderMutex.lock(async () => {
      await this._renderSheet(force, options);
    });
  }

  private async _renderSheet(force?: boolean, options = {}) {
    await this.setExpandedItemData();
    const data = await this.getData();
    this.context.set(data);

    if (force) {
      const { width, height } =
        SheetPreferencesService.getByType(this.actor.type) ?? {};
      this.position = {
        ...this.position,
        width: width ?? this.position.width,
        height: height ?? this.position.height,
      };

      this._saveScrollPositions(this.element);
      this._destroySvelteComponent();
      await super._render(force, options);
      applySheetAttributesToWindow(
        this.actor.documentName,
        this.actor.type,
        SettingsProvider.settings.colorScheme.get(),
        this.element.get(0)
      );
      await this.renderCustomContent({ data, isFullRender: true });
      Hooks.callAll(
        'tidy5e-sheet.renderActorSheet',
        this,
        this.element.get(0),
        data,
        true
      );
      CustomContentRenderer.wireCompatibilityEventListeners(
        this.element,
        super.activateListeners,
        this
      );
      blurUntabbableButtonsOnClick(this.element);
      return;
    }

    await maintainCustomContentInputFocus(this, async () => {
      applyTitleToWindow(this.title, this.element.get(0));
      await this.renderCustomContent({ data, isFullRender: false });
      Hooks.callAll(
        'tidy5e-sheet.renderActorSheet',
        this,
        this.element.get(0),
        data,
        false
      );
      CustomContentRenderer.wireCompatibilityEventListeners(
        this.element,
        super.activateListeners,
        this
      );
    });
  }

  private async renderCustomContent(args: {
    data: CharacterSheetContext;
    isFullRender: boolean;
  }) {
    await CustomContentRenderer.render({
      app: this,
      customContent: args.data.customContent,
      data: args.data,
      element: this.element,
      isFullRender: args.isFullRender,
      superActivateListeners: super.activateListeners,
      tabs: args.data.tabs,
    });
  }

  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    return FoundryAdapter.removeConfigureSettingsButtonWhenLockedForNonGm(
      buttons
    );
  }

  _destroySvelteComponent() {
    this.component?.$destroy();
    this.component = undefined;
  }

  _saveScrollPositions(html: any) {
    if (html.length && this.component) {
      const save = super._saveScrollPositions(html);
      debug('Saved scroll positions', this._scrollPositions);
      return save;
    }
  }

  _disableFields(...args: any[]) {
    debug('Ignoring call to disable fields. Delegating to Tidy Sheets...');
  }

  _onResize(event: any) {
    super._onResize(event);
    const { width, height } = this.position;
    SheetPreferencesService.setDocumentTypePreference(
      this.actor.type,
      'width',
      width
    );
    SheetPreferencesService.setDocumentTypePreference(
      this.actor.type,
      'height',
      height
    );
  }

  /* -------------------------------------------- */
  /* SheetTabCacheable
  /* -------------------------------------------- */

  onTabSelected(tabId: string) {
    this.currentTabId = tabId;
  }

  /* -------------------------------------------- */
  /* SheetExpandedItemsCacheable
  /* -------------------------------------------- */

  onItemToggled(itemId: string, isVisible: boolean, location: string) {
    const locationSet =
      this.expandedItems.get(itemId) ??
      this.expandedItems.set(itemId, new Set<string>()).get(itemId);

    if (isVisible) {
      locationSet?.add(location);
    } else {
      locationSet?.delete(location);
    }

    debug('Item Toggled', {
      expandedItems: this.expandedItems,
    });
  }

  /* -------------------------------------------- */
  /* SearchFilterCacheable
  /* -------------------------------------------- */

  onSearch(location: string, text: string): void {
    debug('Searched', {
      location,
      text,
    });
    this.searchFilters.set(location, text);
  }
}

function getActorClassesToImages(actor: Actor5e): Record<string, string> {
  let actorClassesToImages: Record<string, string> = {};
  for (let item of actor.items) {
    if (item.type == 'class') {
      let className = item.name.toLowerCase();
      let classImg = item.img;
      actorClassesToImages[className] = classImg;
    }
  }
  return actorClassesToImages;
}
