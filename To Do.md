# To Do

## Step by step

- [x] Make proof of concept with svelte
- [x] Exercise some core functionality
  - [x] Rolling
  - [x] Editing data and having it persist
- [x] Global SCSS configured that is scoped to `.tidy5e-kgar`
- [ ] Figure out how flags and settings work
  - [x] Reread this https://foundryvtt.wiki/en/development/guides/handling-data and compare it to Tidy5e's approach
  - [ ] https://foundryvtt.wiki/en/development/api/flags
  - [ ] https://foundryvtt.wiki/en/development/api/settings
- [x] Can the svelte view leverage prosemirror? YES.
- [x] Use context API to provide sheet functions: skipped this. Not enough pain yet to introduce context API.
- [x] Set up project constants for handling T5EK flags
- [ ] Create a type that represents the settings
  - [ ] Ideally, it should contain the data for registering the settings, too, and the type should derive from the data 🤯
- [ ] Properly lock down all gm-only settings
- [x] Implement "Tidy5e KGar Sheet" Game Settings tracer bullet
  - [x] Add section to Game Settings
  - [x] Add setting for color theme
  - [x] Add button for Sheet Settings
  - [x] Add "Save Changes" button with icon
  - [x] Changes should be instantaneously displayed on open sheets (might need to use a svelte store for this)
  - [ ] Stub out the main sheet header
    - [ ] Make it fully functional
      - [ ] Account for TODOs about implementing things
    - [ ] Stub TS types
    - [ ] Encapsulate and organize
  - [ ] Apply styles to make the header look verbatim like the original
  - [ ] Add existing CSS variables
- [x] Register all settings
- [x] Fill out the main settings dialog
- [ ] Implement "Tidy5e KGar Sheet Settings" dialog tracer bullet
  - [x] Create dialog
  - [x] Add Default Player Sheet Width setting
  - [x] Add "Save Changes" button with icon
  - [x] Changes should be instantaneously displayed on open sheets (trigger a render of all open sheets) - 💪 it required awaiting the settings updates when saving changes
- [ ] Fill out remainder of settings
- [ ] ... next steps

## Big Picture

- [ ] Reimplement Tidy5e Sheets with svelte and using foundry/dnd5e API *
  - [ ] Sheet
    - [ ] GM
    - [ ] Unlimited
    - [ ] Limited
    - [ ] Favorites system
  - [ ] NPC
    - [ ] GM
    - [ ] Unlimited
    - [ ] Limited
    - [ ] Favorites system
  - [ ] Vehicle
    - [ ] GM
    - [ ] Unlimited
    - [ ] Limited
    - [ ] Favorites system
  - [ ] Item
    - [ ] Favorites system
- [ ] Reimplement the misc templates
  - [ ] Favorites
    - [ ] Item
    - [ ] Template
  - [ ] Items
    - [ ] spell class filter form
- [ ] Reimplement game settings integration
- [ ] Reimplement sheet settings dialog
- [ ] Remember last selected tab when reopening a tabbed sheet
- [ ] Remember scroll position for every tab in an open sheet, and return to that position when navigating to a tab; default 0
  - [ ] Stretch: can we remember scroll top for a given sheet when closing the sheet and reopening?
    - [ ] What about when reloading Foundry client?
- [ ] All open Tidy sheets should be re-rendered when options are updated
- [ ] Exhaustion is a whole feature unto itself with hooks to integrate with midi QoL. Factor this integration back in.
- [ ] Do I need `data-dtype`?
- [ ] 

> \* Most recent breakages in Tidy5e sheets were related to magic HTML conventions that hook into invisible jquery wire-ups. You have to go read through the core HBS's for character sheets. Since you're already there, skip the limitations imposed by trying to recreate their sheet and instead use the public API. After all the public API provides deprecation notices, whereas the 5e sheet can just suddenly be structured differently on a new version. Not much they will do about that.

## Stretch

- [ ] Explore touch-friendly UX options
  - [ ] More surface area to tap
  - [ ] Larger icons
- [ ] Option macros
  - [ ] Desktop mode
  - [ ] Tablet mode
    - [ ] Turns on touch-friendly UI layout and rearranges relevant content on tabs like Attributes, biography, journal
- [ ] Explore drag-n-drop UI options for where to put things on relevant tabs like Attributes tab with the Proficiencies, skills, resources, etc
  - [ ] Be able to specify a default in sheet settings
  - [ ] Be able to do it live on the sheet in realtime and save as default or just for the current sheet
- [ ] Explore how to test compatibility via [FoundryVTT Container](https://hub.docker.com/r/felddy/foundryvtt)
- [ ] Explore how to perform Automated UI testing with something like [Cypress](https://www.cypress.io/app)
- [ ] Explain levels of exhaustion effects for each individual exhaustion button
- [ ] Study a11y and apply it to the forms