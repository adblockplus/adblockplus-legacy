// Defines whether Adblock Plus is enabled
pref("extensions.adblockplus.enabled", true);

// Value of the "Show tabs on Flash and Java" option */
pref("extensions.adblockplus.frameobjects", true);

// Reverse of the "Collapse blocked elements" option
pref("extensions.adblockplus.fastcollapse", false);

// Value of the "Check banner links" option */
pref("extensions.adblockplus.linkcheck", true);

// Will be set to false if the uses chooses "I know what I'm doing, don't warn me again" on a regexp warning
pref("extensions.adblockplus.warnregexp", true);

// Value of the "Show in toolbar" option
pref("extensions.adblockplus.showintoolbar", true);

// Value of the "Show in status bar" option
pref("extensions.adblockplus.showinstatusbar", false);

// Value of the "Block remote ads in local pages" option
pref("extensions.adblockplus.blocklocalpages", true);

// Will be set to true after toolbar icon for Adblock Plus has been inserted (one-time action)
pref("extensions.adblockplus.checkedtoolbar", false);

// Will be set to true after options from Adblock/Adblock Plus 0.5 have been imported (one-time action)
pref("extensions.adblockplus.checkedadblockprefs", false);

// Will be set to true after filters and synchronization paths from Adblock/Adblock Plus 0.5 have been imported  (one-time action)
pref("extensions.adblockplus.checkedadblocksync", false);

// Will be set to true after checking whether Adblock/Adblock Plus 0.5 is running (one-time action)
pref("extensions.adblockplus.checkedadblockinstalled", false);

// Stores current state of the sidebar - true for "detached"
pref("extensions.adblockplus.detachsidebar", false);

// Min. interval between downloads of a subscription in hours
pref("extensions.adblockplus.synchronizationinterval", 24);

/*
  Action for left-click on toolbar and status bar icons

  0 - None
  1 - Open/close blockable items
  2 - Preferences
  3 - Enable/disable Adblock Plus
*/
pref("extensions.adblockplus.defaulttoolbaraction", 1);
pref("extensions.adblockplus.defaultstatusbaraction", 2);

/*
  Keyboard shortcuts for sidebar, preferences and enabling/disabling

  Must be: modifier1 modifier2 ... letter|special key
  Possible modifiers: Shift, Accel (default accelerator key, e.g. Ctrl on Windows, Command on Mac OS X),
                      Ctrl or Control, Alt, Meta
  Special keys: F7, RIGHT etc, see http://www.xulplanet.com/references/xpcomref/ifaces/nsIDOMKeyEvent.html for full list
*/
pref("extensions.adblockplus.sidebar_key", "Accel Shift B");
pref("extensions.adblockplus.settings_key", "Accel Shift A");
pref("extensions.adblockplus.enable_key", "");

// Defines whether "Flash item's borders" should try to scroll the item into view
pref("extensions.adblockplus.flash_scrolltoitem", true);

// Defines whether images should show up in sidebar's tooltip
pref("extensions.adblockplus.previewimages", true);

/*
  Location of the file containing filters and subscriptions

  Can be either a relative or an absolute file path (relative paths resolved relative to user's profile).
  Support for URLs like http:// will be added later.
*/
pref("extensions.adblockplus.patternsfile", "adblockplus/patterns.ini");

// Maximum number of backups of the patterns file to be stored
pref("extensions.adblockplus.patternsbackups", 5);

// Minimum time interval (in hours) between two backups of the patterns file
pref("extensions.adblockplus.patternsbackupinterval", 24);

// Default filter list (will only be used if patterns file isn't existing and there is nothing to import from Adblock)
pref("extensions.adblockplus.patterns", "@@|https:// */ads/* */advertisements/* http://*.adserver.example.com/*");

/*
  Default ordering of special groups (the order in which missing groups will be added)

  ~il~ - invalid filters
  ~wl~ - exception rules
  ~fl~ - advertisement filters
  ~eh~ - element hiding
*/
pref("extensions.adblockplus.grouporder", "~il~ ~wl~ ~fl~ ~eh~");

/*
  Localized description for the extension
*/
pref("extensions.{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}.description", "chrome://adblockplus/locale/global.properties");

/*
  Content policy types to block. Supported types are: other, script, image,
  stylesheet, object, subdocument, document. Pseudo-types background and link
  will be ignored here.
*/
pref("extensions.adblockplus.blocktypes", "script image stylesheet object subdocument");

// Content policy types that should be checked for links when "check banner links" is activated.
pref("extensions.adblockplus.linktypes", "image");

// Content policy types that shouldn't be collapsed.
pref("extensions.adblockplus.noncollapsabletypes", "script stylesheet background");
