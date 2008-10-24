/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

let abp = null;
try {
  abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance().wrappedJSObject;

  if (!abp.prefs.initialized)
    abp = null;
} catch(e) {}

let prefs, filterStorage, synchronizer, dragService;
if (abp) {
  prefs = abp.prefs;
  filterStorage = abp.filterStorage;
  synchronizer = abp.synchronizer;
  dragService = Components.classes["@mozilla.org/widget/dragservice;1"]
                          .getService(Components.interfaces.nsIDragService);
}
else
  window.close();   // Extension manager opened us without checking whether we are installed properly

const altMask = 2;
const ctrlMask = 4;
const metaMask = 8;

let accelMask = ctrlMask;
try {
  let prefService = Components.classes["@mozilla.org/preferences-service;1"]
                              .getService(Components.interfaces.nsIPrefBranch);
  let accelKey = prefService.getIntPref("ui.key.accelKey");
  if (accelKey == Components.interfaces.nsIDOMKeyEvent.DOM_VK_META)
    accelMask = metaMask;
  else if (accelKey == Components.interfaces.nsIDOMKeyEvent.DOM_VK_ALT)
    accelMask = altMask;
} catch(e) {}

let editorTimeout = null;
function dummyFunction() {}

function E(id)
{
  return document.getElementById(id);
}

// Preference window initialization
function init()
{
  // Insert Apply button between OK and Cancel
  let okBtn = document.documentElement.getButton("accept");
  let cancelBtn = document.documentElement.getButton("cancel");
  let applyBtn = E("applyButton");
  let insertBefore = cancelBtn;
  for (let sibling = cancelBtn; sibling; sibling = sibling.nextSibling)
    if (sibling == okBtn)
      insertBefore = okBtn;
  insertBefore.parentNode.insertBefore(applyBtn, insertBefore);
  applyBtn.setAttribute("disabled", "true");
  applyBtn.hidden = false;

  // Convert menubar into toolbar on Mac OS X
  let isMac = false;
  if ("nsIXULRuntime" in  Components.interfaces)
    isMac = (Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULRuntime).OS == "Darwin");
  else
    isMac = /mac/i.test(window.navigator.oscpu);
  if (isMac)
  {
    function copyAttributes(from, to)
    {
      for (let i = 0; i < from.attributes.length; i++)
        to.setAttribute(from.attributes[i].name, from.attributes[i].value);
    }

    let menubar = E("menu");
    let toolbar = document.createElement("toolbar");
    copyAttributes(menubar, toolbar);

    for (let menu = menubar.firstChild; menu; menu = menu.nextSibling)
    {
      let button = document.createElement("toolbarbutton");
      copyAttributes(menu, button);
      button.setAttribute("type", "menu");
      while (menu.firstChild)
        button.appendChild(menu.firstChild);
      toolbar.appendChild(button);
    }

    menubar.parentNode.replaceChild(toolbar, menubar);
  }

  // Install listeners
  filterStorage.addFilterObserver(onFilterChange);
  filterStorage.addSubscriptionObserver(onSubscriptionChange);

  // Capture keypress events - need to get them before the tree does
  E("listStack").addEventListener("keypress", onListKeyPress, true);

  // Capture keypress events - need to get them before the text field does
  E("FindToolbar").addEventListener("keypress", onFindBarKeyPress, true);

  // Initialize tree view
  E("list").view = treeView;

  let editor = E("listEditor");
  let editorParent = E("listEditorParent");
  editor.height = editor.boxObject.height;
  E("listStack").appendChild(editorParent);
  editorParent.hidden = true;
  treeView.setEditor(editor, editorParent);

  treeView.ensureSelection(0);

  // Set the focus to the input field by default
  E("list").focus();

  // Fire post-load handlers
  let e = document.createEvent("Events");
  e.initEvent("post-load", false, false);
  window.dispatchEvent(e);
}

function setLocation(location)
{
  treeView.stopEditor(true);
  treeView.editorDummyInit = location;
  treeView.selectRow(0);
  editorTimeout = setTimeout(function()
  {
    treeView.startEditor();
  }, 0);
}

function selectFilter(filter)
{
  if (editorTimeout != null)
    clearTimeout(editorTimeout);

  treeView.selectFilter(filter.text);
  E("list").focus();
}

// To be called when the window is closed
function cleanUp()
{
  filterStorage.removeFilterObserver(onFilterChange);
  filterStorage.removeSubscriptionObserver(onSubscriptionChange);
}

// Adds the filter entered into the input field to the list
function addFilter() {
  let info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (info && info[0].special) {
    // Insert editor dummy before an editable pattern
    let pos = (info[1] ? info[1].origPos : 0);
    for (let i = 0; i < info[0].patterns.length; i++) {
      let pattern = info[0].patterns[i];
      if (pattern.origPos >= pos)
        pattern.origPos++;
    }
    info[0].nextPos++;
    treeView.addPattern(null, info[0], info[1] ? pos : -1);
  }
  else {
    // Use default editor dummy
    treeView.selectRow(0);
  }
  treeView.startEditor();
}

// Removes all filters from the list (after a warning).
function clearList() {
  if (confirm(abp.getString("clearall_warning")))
    treeView.removeUserPatterns();
}

// Resets hit statistics (after a warning).
function resetHitCounts(resetAll) {
  if (resetAll && confirm(abp.getString("resethitcounts_warning")))
    filterStorage.resetHitCounts(null);
  else if (!resetAll && confirm(abp.getString("resethitcounts_selected_warning")))
  {
    let selected = treeView.getSelectedInfo();
    let list = [];
    for (let i = 0; i < selected.length; i++)
      if (selected[i][1] && typeof selected[i][1] != "string")
        list.push(selected[i][1].orig);
    filterStorage.resetHitCounts(list);
  }
}

function getDefaultDir() {
  // Copied from Firefox: getTargetFile() in contentAreaUtils.js
  try {
    return prefService.getComplexValue("browser.download.lastDir", Components.interfaces.nsILocalFile);
  }
  catch (e) {
    // No default download location. Default to desktop. 
    let fileLocator = Components.classes["@mozilla.org/file/directory_service;1"]
                                .getService(Components.interfaces.nsIProperties);
  
    return fileLocator.get("Desk", Components.interfaces.nsILocalFile);
  }
}

function saveDefaultDir(dir) {
  // Copied from Firefox: getTargetFile() in contentAreaUtils.js
  try {
    prefService.setComplexValue("browser.download.lastDir", Components.interfaces.nsILocalFile, dir);
  } catch(e) {};
}

// Imports filters from disc.
function importList() {
  let picker = Components.classes["@mozilla.org/filepicker;1"]
                     .createInstance(Components.interfaces.nsIFilePicker);
  picker.init(window, abp.getString("import_filters_title"), picker.modeOpen);
  picker.appendFilters(picker.filterText);
  picker.appendFilters(picker.filterAll);

  let dir = getDefaultDir();
  if (dir)
    picker.displayDirectory = dir;

  if (picker.show() != picker.returnCancel) {
    saveDefaultDir(picker.file.parent.QueryInterface(Components.interfaces.nsILocalFile));
    let stream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                           .createInstance(Components.interfaces.nsIFileInputStream);
    stream.init(picker.file, 0x01, 0444, 0);
    stream = stream.QueryInterface(Components.interfaces.nsILineInputStream);

    let lines = [];
    let line = {value: null};
    while (stream.readLine(line))
      lines.push(abp.normalizeFilter(line.value));
    if (line.value)
      lines.push(abp.normalizeFilter(line.value));
    stream.close();

    if (/\[Adblock(?:\s*Plus\s*([\d\.]+)?)?\]/i.test(lines[0])) {
      let minVersion = RegExp.$1;
      let warning = "";
      if (minVersion && abp.versionComparator.compare(minVersion, abp.getInstalledVersion()) > 0)
        warning = abp.getString("import_filters_wrong_version").replace(/--/, minVersion) + "\n\n";

      let promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                    .getService(Components.interfaces.nsIPromptService);
      let flags = promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_0 +
                  promptService.BUTTON_TITLE_CANCEL * promptService.BUTTON_POS_1 +
                  promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_2;
      let result = promptService.confirmEx(window, abp.getString("import_filters_title"),
        warning + abp.getString("import_filters_warning"), flags, abp.getString("overwrite"),
        null, abp.getString("append"), null, {});
      if (result == 1)
        return;

      if (result == 0)
        treeView.removeUserPatterns();

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i])
          continue;

        treeView.addPattern(lines[i], undefined, undefined, true);
      }

      treeView.ensureSelection(0);
    }
    else 
      alert(abp.getString("invalid_filters_file"));
  }
}

// Exports the current list of filters to a file on disc.
function exportList() {
  if (!treeView.hasUserPatterns())
    return;

  let picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
  picker.init(window, abp.getString("export_filters_title"), picker.modeSave);
  picker.defaultExtension=".txt";
  picker.appendFilters(picker.filterText);
  picker.appendFilters(picker.filterAll);

  let dir = getDefaultDir();
  if (dir)
    picker.displayDirectory = dir;

  if (picker.show() != picker.returnCancel) {
    saveDefaultDir(picker.file.parent.QueryInterface(Components.interfaces.nsILocalFile));
    let lineBreak = abp.getLineBreak();
    try {
      let stream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                            .createInstance(Components.interfaces.nsIFileOutputStream);
      stream.init(picker.file, 0x02 | 0x08 | 0x20, 0644, 0);
  
      let list = ["[Adblock]"];
      let minVersion = "0";
      for (let i = 0; i < treeView.data.length; i++) {
        if (treeView.data[i].special) {
          let patterns = treeView.data[i].patterns.slice();
          patterns.sort(sortNatural);
          for (let j = 0; j < patterns.length; j++) {
            let pattern = patterns[j];
            list.push(pattern.text);

            // Find version requirements of this pattern
            let patternVersion;
            if (pattern.type == "filterlist" || pattern.type == "whitelist") {
              if (abp.Filter.optionsRegExp.test(pattern.text))
                patternVersion = "0.7.1";
              else if (/^(?:@@)?\|/.test(pattern.text) || /\|$/.test(pattern.text))
                patternVersion = "0.6.1.2";
              else
                patternVersion = "0";
            }
            else if (pattern.type == "elemhide") {
              if (/^#([\w\-]+|\*)(?:\(([\w\-]+)\))?$/.test(pattern.text))
                patternVersion = "0.6.1";
              else
                patternVersion = "0.7";
            }
            else
              patternVersion = "0";
            
            // Adjust version requirements of the complete filter set
            if (patternVersion != "0" && abp.versionComparator.compare(minVersion, patternVersion) < 0)
              minVersion = patternVersion;
          }
        }
      }

      if (minVersion != "0") {
        if (abp.versionComparator.compare(minVersion, "0.7.1") >= 0)
          list[0] = "[Adblock Plus " + minVersion + "]";
        else
          list[0] = "(Adblock Plus " + minVersion + " or higher required) " + list[0];
      }

      let output = list.join(lineBreak) + lineBreak;
      stream.write(output, output.length);
  
      stream.close();
    }
    catch (e) {
      dump("Adblock Plus: error writing to file: " + e + "\n");
      alert(abp.getString("filters_write_error"));
    }
  }
}

// Handles keypress event on the patterns list
function onListKeyPress(e) {
  // Ignore any keys directed to the editor
  if (treeView.isEditing())
    return;

  let modifiers = 0;
  if (e.altKey)
    modifiers |= altMask;
  if (e.ctrlKey)
    modifiers |= ctrlMask;
  if (e.metaKey)
    modifiers |= metaMask;

  if ((e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER) && modifiers)
    document.documentElement.acceptDialog();
  else if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER || e.keyCode == e.DOM_VK_F2) {
    e.preventDefault();
    if (editFilter(''))
      e.stopPropagation();
  }
  else if (e.keyCode == e.DOM_VK_BACK_SPACE || e.keyCode == e.DOM_VK_DELETE)
    removeFilters('');
  else if (e.keyCode == e.DOM_VK_INSERT)
    addFilter();
  else if (e.charCode == 32 && !E("enabled").hidden) {
    let forceValue = undefined;
    for (let i = 0; i < treeView.selection.getRangeCount(); i++) {
      let min = {};
      let max = {};
      treeView.selection.getRangeAt(i, min, max);
      for (let j = min.value; j <= max.value; j++)
        forceValue = treeView.toggleDisabled(j, forceValue);
    }
  }
  else if ((e.keyCode == e.DOM_VK_UP || e.keyCode == e.DOM_VK_DOWN) && modifiers == accelMask) {
    moveFilter(e.shiftKey ? 'subscription' : 'filter', e.keyCode == e.DOM_VK_UP);
    e.stopPropagation();
  }
  else if (useTypeAheadFind && e.charCode && modifiers == 0 && String.fromCharCode(e.charCode) != " ") {
    openFindBar(String.fromCharCode(e.charCode));
    e.stopPropagation();
  }
  else if (String.fromCharCode(e.charCode).toLowerCase() == "t" && modifiers == accelMask)
    synchSubscription(false);
}

function onListClick(e) {
  if (e.button != 0)
    return;

  let row = {};
  let col = {};
  treeView.boxObject.getCellAt(e.clientX, e.clientY, row, col, {});

  if (!col.value)
    return;

  col = col.value.id;
  if (col == "pattern" && row.value == 0)
    editFilter('');

  if (col != "enabled")
    return;

  treeView.toggleDisabled(row.value);
}

function onListDragGesture(e) {
  treeView.startDrag(treeView.boxObject.getRowAt(e.clientX, e.clientY));
}

function onSubscriptionChange(action, subscriptions)
{
  // TODO

  // Checking orig instanceof Array won't work (array created in different context)
  if ("url" in orig) {
    // Subscription changed

    let subscription = null;
    for (let i = 0; i < treeView.data.length; i++) {
      if (treeView.data[i].url == orig.url) {
        subscription = treeView.data[i];
        break;
      }
    }
  
    let row, rowCount;
    if (!subscription && (status == "add" || status == "replace")) {
      subscription = cloneObject(orig);
      subscription.dummy = false;
      row = treeView.rowCount;
      rowCount = 0;
      treeView.data.push(subscription);
    }
    else if (subscription && status == "remove") {
      treeView.removeRow([subscription, null]);
      return;
    }
    else if (subscription) {
      row = treeView.getSubscriptionRow(subscription);
      rowCount = treeView.getSubscriptionRowCount(subscription);
      if (status == "replace" || status == "info") {
        subscription = cloneObject(orig);
        subscription.dummy = false;
        treeView.data[i] = subscription;
      }
    }
  
    if (!subscription)
      return;
  
    subscription.extra = treeView.getSubscriptionDescription(subscription);
    treeView.initSubscriptionPatterns(subscription, orig.patterns);
    treeView.invalidateSubscription(subscription, row, rowCount);

    // Date.toLocaleString() doesn't handle Unicode properly if called directly from XPCOM (bug 441370)
    setTimeout(function() {
        subscription.extra = treeView.getSubscriptionDescription(subscription);
        treeView.invalidateSubscriptionInfo(subscription);
    }, 0);
  }
  else {
    // Filters changed

    if (status == "add") {
      for each (let pattern in orig)
        treeView.addPattern(pattern, undefined, undefined, true);
    }
    else if (status == "remove") {
      for each (let pattern in orig)
        treeView.removePattern(pattern);
    }
    else if (status == "disable") {
      if (!E("enabled").hidden)
      {
        for each (let pattern in orig)
        {
          treeView.disabled[pattern.text] = pattern.disabled;
          treeView.invalidatePattern(pattern);
        }
      }
    }
  }
}

function editFilter(type) {
  let info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (info && type!= "filter" && !info[0].special && (info[1] || type == "subscription"))
    return editSubscription(info[0]);
  else
    return treeView.startEditor();
}

// Starts editor for a given subscription
function editSubscription(subscription) {
  let result = {};
  if (subscription)
    openDialog("subscription.xul", "_blank", "chrome,centerscreen,modal", subscription, result);
  else
    openDialog("tip_subscriptions.xul", "_blank", "chrome,centerscreen,modal", result);

  if (!("url" in result))
    return true;

  let newSubscription = null;
  for (let i = 0; i < treeView.data.length; i++)
    if (treeView.data[i].url == result.url)
      newSubscription = treeView.data[i];

  if (subscription && newSubscription && subscription != newSubscription)
    treeView.removeRow([subscription, null]);

  let orig = (result.url in prefs.knownSubscriptions ? prefs.knownSubscriptions[result.url] : prefs.subscriptionFromURL(result.url));

  if (subscription && !newSubscription)
    newSubscription = subscription;

  let row = (newSubscription ? treeView.getSubscriptionRow(newSubscription) : -1);
  let rowCount = (newSubscription ? treeView.getSubscriptionRowCount(newSubscription) : 0);

  if (!newSubscription) {
    newSubscription = cloneObject(orig);
    newSubscription.dummy = false;
    treeView.data.push(newSubscription);
  }
  
  newSubscription.url = result.url;
  newSubscription.title = result.title;
  newSubscription.disabled = result.disabled;
  newSubscription.autoDownload = result.autoDownload;
  newSubscription.extra = treeView.getSubscriptionDescription(newSubscription);
  treeView.initSubscriptionPatterns(newSubscription, orig.patterns);

  treeView.invalidateSubscription(newSubscription, row, rowCount);
  treeView.selectSubscription(newSubscription);

  onChange();

  if (!orig.lastDownload)
    synchronizer.execute(orig);

  return true;
}

// Removes the selected entries from the list and sets selection to the next item
function removeFilters(type) {
  // Retrieve selected items
  let selected = treeView.getSelectedInfo();

  let removable = [];
  if (type != "subscription")
    for (let i = 0; i < selected.length; i++)
      if (selected[i][0].special && selected[i][1] && typeof selected[i][1] != "string")
        removable.push(selected[i]);

  if (removable.length) {
    for (let i = 0; i < removable.length; i++)
      treeView.removeRow(removable[i]);
  }
  else if (type != "filter") {
    // No removable patterns found, maybe we should remove the subscription?
    let subscription = null;
    for (let i = 0; i < selected.length; i++) {
      if (!subscription)
        subscription = selected[i][0];
      else if (subscription != selected[i][0])
        return;
    }

    if (subscription && !subscription.special && !subscription.dummy && confirm(abp.getString("remove_subscription_warning")))
      treeView.removeRow([subscription, null]);
  }
}

// Copies selected filters to clipboard
function copyToClipboard() {
  // Retrieve selected items
  let selected = treeView.getSelectedInfo();

  let lines = [];
  for (let i = 0; i < selected.length; i++)
    if (selected[i][1] && typeof selected[i][1] != "string")
      lines.push(selected[i][1].text);

  if (!lines.length)
    return;

  let clipboardHelper = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                                  .getService(Components.interfaces.nsIClipboardHelper);
  let lineBreak = abp.getLineBreak();
  clipboardHelper.copyString(lines.join(lineBreak) + lineBreak);
}

// Pastes text as filter list from clipboard
function pasteFromClipboard() {
  let clipboard = Components.classes["@mozilla.org/widget/clipboard;1"]
                            .getService(Components.interfaces.nsIClipboard);
  let transferable = Components.classes["@mozilla.org/widget/transferable;1"]
                               .createInstance(Components.interfaces.nsITransferable);
  transferable.addDataFlavor("text/unicode");

  try {
    clipboard.getData(transferable, clipboard.kGlobalClipboard);
  }
  catch (e) {
    return;
  }

  let data = {};
  transferable.getTransferData("text/unicode", data, {});

  try {
    data = data.value.QueryInterface(Components.interfaces.nsISupportsString).data;
  }
  catch (e) {
    return;
  }

  let lines = data.split(/[\r\n]+/);
  for (let i = 0; i < lines.length; i++) {
    let line = abp.normalizeFilter(lines[i]);
    if (!line)
      continue;

    treeView.addPattern(line);
  }
}

// Starts synchronization for a subscription
function synchSubscription(forceDownload) {
  let info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (!info || info[0].special || info[0].external || info[0].dummy)
    return;

  let orig = prefs.knownSubscriptions[info[0].url];
  synchronizer.execute(orig, forceDownload);
}

// Starts synchronization for all subscriptions
function synchAllSubscriptions(forceDownload) {
  for (let i = 0; i < treeView.data.length; i++) {
    let subscription = treeView.data[i];
    if (!subscription.special && !subscription.external && !subscription.dummy) {
      let orig = prefs.knownSubscriptions[subscription.url];
      synchronizer.execute(orig, forceDownload);
    }
  }
}

// Moves a pattern or subscription up and down in the list
function moveFilter(type, up) {
  let info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (!info)
    return;

  if (type == "subscription")
    info[1] = null;
  treeView.moveRow(info, up ? -1 : 1);
}

// Makes sure the right items in the options popup are checked/enabled
function fillFiltersPopup(prefix) {
  let empty = !treeView.hasUserPatterns();
  E("export-command").setAttribute("disabled", empty);
  E("clearall").setAttribute("disabled", empty);
}

// Makes sure the right items in the options popup are checked
function fillOptionsPopup() {
  E("abp-enabled").setAttribute("checked", prefs.enabled);
  E("frameobjects").setAttribute("checked", prefs.frameobjects);
  E("slowcollapse").setAttribute("checked", !prefs.fastcollapse);
  E("showintoolbar").setAttribute("checked", prefs.showintoolbar);
  E("showinstatusbar").setAttribute("checked", prefs.showinstatusbar);
}

// Makes sure the right items in the context menu are checked/enabled
function fillContext() {
  // Retrieve selected items
  let selected = treeView.getSelectedInfo();
  let current = (selected.length ? selected[0] : null);

  // Check whether all selected items belong to the same subscription
  let subscription = null;
  for (let i = 0; i < selected.length; i++) {
    if (!subscription)
      subscription = selected[i][0];
    else if (selected[i][0] != subscription) {
      // More than one subscription selected, ignoring it
      subscription = null;
      break;
    }
  }

  // Check whether any patterns have been selected and whether any of them can be removed
  let hasPatterns = false;
  let hasRemovable = false;
  for (i = 0; i < selected.length; i++) {
    if (selected[i][1] && typeof selected[i][1] != "string") {
      hasPatterns = true;
      if (selected[i][0].special)
        hasRemovable = true;
    }
  }

  // Nothing relevant selected
  if (!subscription && !hasPatterns)
    return false;

  let origHasPatterns = hasPatterns;
  if (subscription && hasPatterns && !subscription.special)
    hasPatterns = false;

  E("context-filters-sep").hidden = !hasPatterns && (!subscription || subscription.special || subscription.dummy);

  E("context-resethitcount").hidden = !origHasPatterns;

  E("context-edit").hidden =
    E("context-moveup").hidden =
    E("context-movedown").hidden =
    !hasPatterns;

  E("context-synchsubscription").hidden =
    E("context-editsubscription").hidden =
    !subscription || subscription.special || subscription.dummy;

  E("context-movegroupup").hidden =
    E("context-movegroupdown").hidden =
    E("context-group-sep").hidden =
    !subscription;

  if (subscription) {
    E("context-synchsubscription").setAttribute("disabled", subscription.special || subscription.external);
    E("context-movegroupup").setAttribute("disabled", subscription.dummy || treeView.isFirstSubscription(subscription));
    E("context-movegroupdown").setAttribute("disabled", subscription.dummy || treeView.isLastSubscription(subscription));
  }

  if (hasPatterns) {
    let editable = (current && current[0].special && current[1] && typeof current[1] != "string");

    let isFirst = true;
    let isLast = true;
    if (editable && !treeView.isSorted()) {
      for (i = 0; i < current[0].patterns.length; i++) {
        if (current[0].patterns[i] == current[1]) {
          isFirst = (i == 0);
          isLast = (i == current[0].patterns.length - 1);
          break;
        }
      }
    }

    E("context-edit").setAttribute("disabled", !editable);
    E("context-moveup").setAttribute("disabled", isFirst);
    E("context-movedown").setAttribute("disabled", isLast);
  }

  let clipboard = Components.classes["@mozilla.org/widget/clipboard;1"]
                            .getService(Components.interfaces.nsIClipboard);

  let hasFlavour = true;
  if (clipboard.hasDataMatchingFlavors.arity > 2)
  {
    // Gecko 1.9
    hasFlavour = clipboard.hasDataMatchingFlavors(["text/unicode"], 1, clipboard.kGlobalClipboard);
  }
  else
  {
    // Gecko 1.8
    let flavours = Components.classes["@mozilla.org/supports-array;1"]
                             .createInstance(Components.interfaces.nsISupportsArray);
    let flavourString = Components.classes["@mozilla.org/supports-cstring;1"]
                                  .createInstance(Components.interfaces.nsISupportsCString);
    flavourString.data = "text/unicode";
    flavours.AppendElement(flavourString);
    hasFlavour = clipboard.hasDataMatchingFlavors(flavours, clipboard.kGlobalClipboard);
  }

  E("copy-command").setAttribute("disabled", !origHasPatterns);
  E("cut-command").setAttribute("disabled", !hasRemovable);
  E("paste-command").setAttribute("disabled", !hasFlavour);
  E("remove-command").setAttribute("disabled", !hasRemovable && (!subscription || subscription.special || subscription.dummy));

  return true;
}

// Toggles the value of a boolean pref
function togglePref(pref) {
  prefs[pref] = !prefs[pref];
  prefs.save();
}

// Updates hit count column whenever a value changes
function onFilterChange(action, filters)
{
  if (action == "hit" && (!E("hitcount").hidden || !E("lasthit").hidden))
  {
    if (filters.length == 1)
      treeView.invalidatePattern(filters[0]);
    else
      treeView.boxObject.invalidate();
  }
}

// Saves the filter list
function applyChanges() {
  treeView.applyChanges();
  E("applyButton").setAttribute("disabled", "true");
}

// Checks whether user's mouse use hovering over a regexp exclamation mark
function showRegExpTooltip(event) {
  let col = {};
  let childElement = {};
  treeView.boxObject.getCellAt(event.clientX, event.clientY, {}, col, childElement);
  return (col.value.id == "pattern" && childElement.value == "image");
}

// Opens About Adblock Plus dialog
function openAbout() {
  openDialog("about.xul", "_blank", "chrome,centerscreen,modal");
}

// To be called whenever the filter list has been changed and changes can be applied
function onChange() {
  E("applyButton").removeAttribute("disabled");
}

// Creates a copy of an object by copying all its properties
function cloneObject(obj) {
  let ret = {};
  for (let key in obj)
    ret[key] = obj[key];

  return ret;
}

// Sort functions for the filter list
function sortByText(pattern1, pattern2) {
  if (pattern1.text < pattern2.text)
    return -1;
  else if (pattern1.text > pattern2.text)
    return 1;
  else
    return 0;
}

function sortByTextDesc(pattern1, pattern2) {
  return -sortByText(pattern1, pattern2);
}

function compareEnabled(pattern1, pattern2) {
  let hasEnabled1 = (pattern1.type != "comment" && pattern1.type != "invalid" ? 1 : 0);
  let hasEnabled2 = (pattern2.type != "comment" && pattern2.type != "invalid" ? 1 : 0);
  if (hasEnabled1 != hasEnabled2)
    return hasEnabled1 - hasEnabled2;
  else if (hasEnabled1 && (pattern1.text in treeView.disabled) != (pattern2.text in treeView.disabled))
    return (pattern1.text in treeView.disabled ? -1 : 1);
  else
    return 0;
}

function compareHitCount(pattern1, pattern2) {
  let hasHitCount1 = (pattern1.type != "comment" && pattern1.type != "invalid" ? 1 : 0);
  let hasHitCount2 = (pattern2.type != "comment" || pattern2.type != "invalid" ? 1 : 0);
  if (hasHitCount1 != hasHitCount2)
    return hasHitCount1 - hasHitCount2;
  else if (hasHitCount1)
    return pattern1.orig.hitCount - pattern2.orig.hitCount;
  else
    return 0;
}

function compareLastHit(pattern1, pattern2) {
  let hasLastHit1 = (pattern1.type != "comment" && pattern1.type != "invalid" ? 1 : 0);
  let hasLastHit2 = (pattern2.type != "comment" && pattern2.type != "invalid" ? 1 : 0);
  if (hasLastHit1 != hasLastHit2)
    return hasLastHit1 - hasLastHit2;
  else if (hasLastHit1)
    return pattern1.orig.lastHit - pattern2.orig.lastHit;
  else
    return 0;
}

function sortNatural(pattern1, pattern2) {
  return pattern1.origPos - pattern2.origPos;
}

function createSortWithFallback(cmpFunc, fallbackFunc, desc) {
  let factor = (desc ? -1 : 1);

  return function(pattern1, pattern2) {
    let ret = cmpFunc(pattern1, pattern2);
    if (ret == 0)
      return fallbackFunc(pattern1, pattern2);
    else
      return factor * ret;
  }
}

// Filter list's tree view object
const nsITreeView = Components.interfaces.nsITreeView;
let treeView = {
  //
  // nsISupports implementation
  //

  QueryInterface: function(uuid) {
    if (!uuid.equals(Components.interfaces.nsISupports) &&
        !uuid.equals(Components.interfaces.nsITreeView))
    {
      throw Components.results.NS_ERROR_NO_INTERFACE;
    }
  
    return this;
  },

  //
  // nsITreeView implementation
  //

  setTree: function(boxObject) {
    if (!boxObject)
      return;

    this.boxObject = boxObject;

    let stringAtoms = ["col-pattern", "col-enabled", "col-hitcount", "col-lasthit", "type-comment", "type-filterlist", "type-whitelist", "type-elemhide", "type-invalid"];
    let boolAtoms = ["selected", "dummy", "subscription", "description", "pattern", "pattern-regexp", "subscription-special", "subscription-external", "subscription-autoDownload", "subscription-disabled", "subscription-upgradeRequired", "pattern-disabled"];
    let atomService = Components.classes["@mozilla.org/atom-service;1"]
                                .getService(Components.interfaces.nsIAtomService);

    this.atoms = {};
    for each (let atom in stringAtoms)
      this.atoms[atom] = atomService.getAtom(atom);
    for each (let atom boolAtoms)
    {
      this.atoms[atom + "-true"] = atomService.getAtom(atom + "-true");
      this.atoms[atom + "-false"] = atomService.getAtom(atom + "-false");
    }

    this.typemap = {__proto__: null};
    this.disabled = {__proto__: null};

    // Copy the subscription list, we don't want to apply our changes immediately
    this.data = filterStorage.subscriptions.slice();

    this.closed = {__proto__: null};
    let closed = this.boxObject.treeBody.parentNode.getAttribute("closedSubscriptions");
    if (closed)
      for each (let id in closed.split(" "))
        this.closed[id] = true;

    // Check current sort direction
    let cols = document.getElementsByTagName("treecol");
    let sortDir = null;
    for (let i = 0; i < cols.length; i++)
    {
      let col = cols[i];
      let dir = col.getAttribute("sortDirection");
      if (dir && dir != "natural")
      {
        this.sortColumn = col;
        sortDir = dir;
      }
    }

    if (this.sortColumn)
      this.resort(this.sortColumn.id, sortDir);

    // Make sure we stop the editor when scrolling
    let me = this;
    this.boxObject.treeBody.addEventListener("DOMMouseScroll", function()
    {
      me.stopEditor(true);
    }, false);
  },

  get rowCount() {
    let count = 0;
    for (let i = 0; i < this.data.length; i++) {
      let subscription = this.data[i];

      // Special groups are only shown if they aren't empty
      if (subscription.special && subscription.patterns.length == 0)
        continue;

      count++;
      if (!(subscription.url in this.closed))
        count += subscription.extra.length + subscription.patterns.length;
    }

    return count;
  },

  getCellText: function(row, col) {
    col = col.id;

    // Only three columns have text
    if (col != "pattern" && col != "hitcount" && col != "lasthit")
      return "";

    // Don't show text in the edited row
    if (col == "pattern" && this.editedRow == row)
      return "";

    let info = this.getRowInfo(row);
    if (!info)
      return "";

    if (info[1] && typeof info[1] != "string") {
      if (col == "pattern")
        return info[1].text;
      else if (!info[1].dummy && info[1].type != "comment" && info[1].type != "invalid") {
        if (col == "hitcount")
          return info[1].orig.hitCount;
        else
          return (info[1].orig.lastHit ? new Date(info[1].orig.lastHit).toLocaleString() : null);
      }
      else
        return null;
    }
    else if (col != "pattern")
      return null;
    else if (!info[1])
      return (info[0].special || info[0].dummy ? "" : this.titlePrefix) + info[0].title;
    else
      return info[1];
  },

  getColumnProperties: function(col, properties) {
    col = col.id;

    if ("col-" + col in this.atoms)
      properties.AppendElement(this.atoms["col-" + col]);
  },

  getRowProperties: function(row, properties) {
    let info = this.getRowInfo(row);
    if (!info)
      return;

    let origSubscription = prefs.knownSubscriptions[info[0].url];
    if (typeof origSubscription == "undefined")
      origSubscription = null;

    properties.AppendElement(this.atoms["selected-" + this.selection.isSelected(row)]);
    properties.AppendElement(this.atoms["subscription-" + !info[1]]);
    properties.AppendElement(this.atoms["pattern-" + !!(info[1] && typeof info[1] != "string")]);
    properties.AppendElement(this.atoms["pattern-regexp-" + !!(info[1] && typeof info[1] != "string" && (info[1].type == "filterlist" || info[1].type == "whitelist") && !("shortcut" in info[1]))]);
    properties.AppendElement(this.atoms["description-" + !!(info[1] && typeof info[1] == "string")]);
    properties.AppendElement(this.atoms["subscription-special-" + info[0].special]);
    properties.AppendElement(this.atoms["subscription-external-" + (!info[0].special && info[0].external)]);
    properties.AppendElement(this.atoms["subscription-autoDownload-" + (info[0].special || info[0].autoDownload)]);
    properties.AppendElement(this.atoms["subscription-disabled-" + (!info[0].special && info[0].disabled)]);
    properties.AppendElement(this.atoms["subscription-upgradeRequired-" + (origSubscription && "upgradeRequired" in origSubscription)]);
    let dummy = info[0].dummy;
    if (info[1] && typeof info[1] != "string") {
      dummy = info[1].dummy;
      if (info[1].type != "comment" && info[1].type != "invalid")
        properties.AppendElement(this.atoms["pattern-disabled-" + (info[1].text in this.disabled)]);
      if ("type-" + info[1].type in this.atoms)
        properties.AppendElement(this.atoms["type-" + info[1].type]);
    }
    properties.AppendElement(this.atoms["dummy-" + dummy]);
  },

  getCellProperties: function(row, col, properties)
  {
    this.getColumnProperties(col, properties);
    this.getRowProperties(row, properties);
  },

  isContainer: function(row) {
    let info = this.getRowInfo(row);
    return info && !info[1];
  },

  isContainerOpen: function(row) {
    let info = this.getRowInfo(row);
    return info && !info[1] && !(info[0].url in this.closed);
  },

  isContainerEmpty: function(row) {
    let info = this.getRowInfo(row);
    return info && !info[1] && info[0].extra.length + info[0].patterns.length == 0;
  },

  getLevel: function(row) {
    let info = this.getRowInfo(row);
    return (info && info[1] ? 1 : 0);
  },

  getParentIndex: function(row) {
    let info = this.getRowInfo(row);
    if (!info || !info[1])
      return -1;

    return this.getSubscriptionRow(info[0]);
  },

  hasNextSibling: function(row, afterRow) {
    let info = this.getRowInfo(row);
    if (!info || !info[1])
      return false;

    let infoIndex = this.getSubscriptionRow(info[0]);
    if (infoIndex < 0)
      return false;

    return (infoIndex + info[0].extra.length + info[0].patterns.length > afterRow);
  },

  toggleOpenState: function(row) {
    let info = this.getRowInfo(row);
    if (!info || info[1])
      return;

    let count = info[0].extra.length + info[0].patterns.length;
    if (info[0].url in this.closed) {
      delete this.closed[info[0].url];
      this.boxObject.rowCountChanged(row + 1, count);
    }
    else {
      this.closed[info[0].url] = true;
      this.boxObject.rowCountChanged(row + 1, -count);
    }
    this.boxObject.invalidateRow(row);

    let closed = [];
    for (let id in this.closed)
      closed.push(id);
    this.boxObject.treeBody.parentNode.setAttribute("closedSubscriptions", closed.join(" "));
  },

  cycleHeader: function(col) {
    col = col.element;

    let cycle = {
      natural: 'ascending',
      ascending: 'descending',
      descending: 'natural'
    };

    let curDirection = "natural";
    if (this.sortColumn == col)
      curDirection = col.getAttribute("sortDirection");
    else if (this.sortColumn)
      this.sortColumn.removeAttribute("sortDirection");

    curDirection = cycle[curDirection];

    this.resort(col.id, curDirection);

    col.setAttribute("sortDirection", curDirection);
    this.sortColumn = col;

    this.boxObject.invalidate();
  },

  isSorted: function() {
    return (this.sortProc != sortNatural);
  },

  DROP_ON: nsITreeView.DROP_ON,
  DROP_BEFORE: nsITreeView.DROP_BEFORE,
  DROP_AFTER: nsITreeView.DROP_AFTER,
  canDrop: function(row, orientation) {
    let session = dragService.getCurrentSession();
    if (!session || session.sourceNode != this.boxObject.treeBody || !this.dragData || orientation == this.DROP_ON)
      return false;

    let info = this.getRowInfo(row);
    if (!info)
      return false;

    if (this.dragData[1]) {
      // Dragging a pattern
      return info[1] && info[0] == this.dragData[0];
    }
    else {
      // Dragging a subscription
      return (!info[0].dummy || orientation == this.DROP_AFTER);
    }
  },
  drop: function(row, orientation) {
    let session = dragService.getCurrentSession();
    if (!session || session.sourceNode != this.boxObject.treeBody || !this.dragData || orientation == this.DROP_ON)
      return;

    let info = this.getRowInfo(row);
    if (!info)
      return;

    if (this.dragData[1]) {
      // Dragging a pattern
      if (!info[1] || info[0] != this.dragData[0])
        return;

      let index1 = -1;
      let index2 = -1;
      for (let i = 0; i < info[0].patterns.length; i++) {
        if (info[0].patterns[i] == this.dragData[1])
          index1 = i;
        if (info[0].patterns[i] == info[1])
          index2 = i;
      }
      if (index1 < 0 || index2 < 0)
        return;

      if (orientation == this.DROP_AFTER)
        index2++;
      if (index2 > index1)
        index2--;

      this.moveRow(this.dragData, index2 - index1);
    }
    else {
      // Dragging a subscription
      let index1 = -1;
      let index2 = -1;
      let index = 0;
      for (i = 0; i < this.data.length; i++) {
        // Ignore invisible groups
        if (this.data[i].special && this.data[i].patterns.length == 0)
          continue;

        if (this.data[i] == this.dragData[0])
          index1 = index;
        if (this.data[i] == info[0])
          index2 = index;

        index++;
      }
      if (index1 < 0 || index2 < 0)
        return;
      if ((info[0].url in this.closed) && orientation == this.DROP_AFTER)
        index2++;
      if (!(info[0].url in this.closed) && index2 > index1 && (info[1] || orientation == this.DROP_AFTER))
        index2++;
      if (index2 > index1)
        index2--;

      this.moveRow(this.dragData, index2 - index1);
    }
  },

  getCellValue: function() {return null},
  getProgressMode: function() {return null},
  getImageSrc: function() {return null},
  isSeparator: function() {return false},
  isEditable: function() {return false},
  cycleCell: function() {},
  performAction: function() {},
  performActionOnRow: function() {},
  performActionOnCell: function() {},
  selection: null,
  selectionChanged: function() {},

  //
  // Custom properties and methods
  //

  typemap: null,
  data: null,
  boxObject: null,
  closed: null,
  disabled: null,
  titlePrefix: abp.getString("subscription_description") + " ",
  atoms: null,
  sortColumn: null,
  sortProc: sortNatural,

  // Returns an array containing description for a subscription group
  getSubscriptionDescription: function(subscription) {
    let descr = [];

    if (subscription.special || !(subscription.url in prefs.knownSubscriptions))
      return descr;

    let orig = prefs.knownSubscriptions[subscription.url];

    if ("upgradeRequired" in orig)
      descr.push(abp.getString("subscription_wrong_version").replace(/--/, orig.requiredVersion));

    if (!orig.external)
      descr.push(abp.getString("subscription_source") + " " + subscription.url);

    let status = "";
    if (orig.external)
      status += abp.getString("subscription_status_externaldownload");
    else
      status += (subscription.autoDownload ? abp.getString("subscription_status_autodownload") : abp.getString("subscription_status_manualdownload"));

    status += "; " + abp.getString("subscription_status_lastdownload") + " ";
    if (synchronizer.isExecuting(subscription.url))
      status += abp.getString("subscription_status_lastdownload_inprogress");
    else {
      status += (orig.lastDownload > 0 ? new Date(orig.lastDownload * 1000).toLocaleString() : abp.getString("subscription_status_lastdownload_unknown"));
      if (orig.lastDownload > 0 && orig.downloadStatus) {
        try {
          status += " (" + abp.getString(orig.downloadStatus) + ")";
        } catch (e) {}
      }
    }

    descr.push(abp.getString("subscription_status") + " " + status);
    return descr;
  },

  initSubscriptionPatterns: function(subscription, patterns) {
    subscription.patterns = [];
    subscription.nextPos = 0;
    for (let i = 0; i < patterns.length; i++) {
      let pattern = cloneObject(patterns[i]);
      pattern.orig = patterns[i];
      pattern.origPos = subscription.nextPos++;
      pattern.dummy = false;
      subscription.patterns.push(pattern);
    }

    if (this.sortProc != sortNatural)
      subscription.patterns.sort(this.sortProc);
  },

  getSubscriptionRow: function(subscription) {
    let index = 0;
    for (let i = 0; i < this.data.length; i++) {
      // Special groups are only shown if they aren't empty
      if (this.data[i].special && this.data[i].patterns.length == 0)
        continue;

      if (this.data[i] == subscription)
        return index;

      index++;
      if (!(this.data[i].url in this.closed))
        index += this.data[i].extra.length + this.data[i].patterns.length;
    }
    return -1;
  },

  getSubscriptionRowCount: function(subscription) {
    if (subscription.special && subscription.patterns.length == 0)
      return 0;

    let ret = 1;
    if (!(subscription.url in this.closed))
      ret += subscription.extra.length + subscription.patterns.length;

    return ret;
  },

  getRowInfo: function(row) {
    for (let i = 0; i < this.data.length; i++) {
      let subscription = this.data[i];

      // Special groups are only shown if they aren't empty
      if (subscription.special && subscription.patterns.length == 0)
        continue;

      // Check whether the group row has been requested
      row--;
      if (row < 0)
        return [subscription, null];

      if (!(subscription.url in this.closed)) {
        // Check whether the subscription description row has been requested
        if (row < subscription.extra.length)
          return [subscription, subscription.extra[row]];

        row -= subscription.extra.length;

        // Check whether one of the patterns has been requested
        if (row < subscription.patterns.length)
          return [subscription, subscription.patterns[row]];

        row -= subscription.patterns.length;
      }
    }

    return null;
  },

  // Returns the info for all selected rows, starting with the current row
  getSelectedInfo: function() {
    let selected = [];
    for (let i = 0; i < this.selection.getRangeCount(); i++) {
      let min = {};
      let max = {};
      this.selection.getRangeAt(i, min, max);
      for (let j = min.value; j <= max.value; j++) {
        let info = this.getRowInfo(j);
        if (info) {
          if (j == treeView.selection.currentIndex)
            selected.unshift(info);
          else
            selected.push(info);
        }
      }
    }
    return selected;
  },

  sortProcs: {
    pattern: sortByText,
    patternDesc: sortByTextDesc,
    enabled: createSortWithFallback(compareEnabled, sortByText, false),
    enabledDesc: createSortWithFallback(compareEnabled, sortByText, true),
    hitcount: createSortWithFallback(compareHitCount, sortByText, false),
    hitcountDesc: createSortWithFallback(compareHitCount, sortByText, true),
    lasthit: createSortWithFallback(compareLastHit, sortByText, false),
    lasthitDesc: createSortWithFallback(compareLastHit, sortByText, true),
    natural: sortNatural
  },

  resort: function(col, direction) {
    this.sortProc = this.sortProcs[col];
    if (direction == "natural")
      this.sortProc = this.sortProcs.natural;
    else if (direction == "descending")
      this.sortProc = this.sortProcs[col + "Desc"];

    for (let i = 0; i < this.data.length; i++)
      this.data[i].patterns.sort(this.sortProc);
  },

  selectRow: function(row) {
    treeView.selection.select(row);
    treeView.boxObject.ensureRowIsVisible(row);
  },

  selectFilter: function(text) {
    for (let i = 0; i < this.data.length; i++) {
      for (let j = 0; j < this.data[i].patterns.length; j++) {
        if (this.data[i].patterns[j].text == text) {
          let parentRow = this.getSubscriptionRow(this.data[i]);
          if (this.data[i].url in this.closed)
            this.toggleOpenState(parentRow);
          this.selection.select(parentRow + 1 + this.data[i].extra.length + j);
          this.boxObject.ensureRowIsVisible(parentRow + 1 + this.data[i].extra.length + j);
        }
      }
    }
  },

  selectSubscription: function(subscription) {
    let row = this.getSubscriptionRow(subscription);
    if (row < 0)
      return;

    this.selection.select(row);
    this.boxObject.ensureRowIsVisible(row);
  },

  ensureSelection: function(row) {
    if (this.selection.count == 0) {
      let rowCount = this.rowCount;
      if (row >= rowCount)
        row = rowCount - 1;
      if (row >= 0) {
        this.selection.select(row);
        this.boxObject.ensureRowIsVisible(row);
      }
    }
    else if (this.selection.currentIndex < 0) {
      let min = {};
      this.selection.getRangeAt(0, min, {});
      this.selection.currentIndex = min.value;
    }
  },

  hasUserPatterns: function() {
    for (let i = 0; i < this.data.length; i++)
      if (this.data[i].special && this.data[i].patterns.length)
        return true;

    return false;
  },

  isFirstSubscription: function(subscription) {
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i].dummy || (this.data[i].special && this.data[i].patterns.length == 0))
        continue;

      return (this.data[i] == subscription);
    }
    return false;
  },

  isLastSubscription: function(subscription) {
    for (let i = this.data.length - 1; i >= 0; i--) {
      if (this.data[i].dummy || (this.data[i].special && this.data[i].patterns.length == 0))
        continue;

      return (this.data[i] == subscription);
    }
    return false;
  },

  // Adds a pattern to a subscription
  addPattern: function(text, origSubscription, origPos, noSelect) {
    let i, parentRow

    if (text) {
      // Real pattern being added, not a dummy
      let pattern = prefs.patternFromText(text);
      if (!pattern || !(pattern.type in treeView.typemap))
        return;

      let subscription = treeView.typemap[pattern.type];
      if (typeof origSubscription == "undefined" || typeof origPos == "undefined" || origSubscription != subscription)
        origPos = -1;
    
      // Maybe we have this pattern already, check this
      for (i = 0; i < subscription.patterns.length; i++) {
        if (subscription.patterns[i].text == pattern.text) {
          if (typeof noSelect == "undefined" || !noSelect) {
            parentRow = this.getSubscriptionRow(subscription);
            if (subscription.url in this.closed)
              this.toggleOpenState(parentRow);
  
            this.selection.select(parentRow + 1 + subscription.extra.length + i);
            this.boxObject.ensureRowIsVisible(parentRow + 1 + subscription.extra.length + i);
          }
          return;
        }
      }

      let orig = pattern;
      pattern = cloneObject(pattern);
      pattern.orig = orig;
      pattern.dummy = false;

      if ((pattern.type == "filterlist" || pattern.type == "whitelist") && !abp.Filter.regexpRegExp.test(pattern.text)) {
        let matcher = (pattern.type == "filterlist" ? abp.prefs.filterPatterns : abp.prefs.whitePatterns);
        let shortcut = matcher.findShortcut(pattern.text);
        if (shortcut)
          pattern.shortcut = shortcut;
      }
    }
    else {
      // Adding a dummy
      pattern = {
        text: "",
        type: "dummy",
        disabled: false,
        dummy: true
      };
      subscription = origSubscription;

      let topMost = false;
      if (origPos < 0) {
        // Inserting at list top
        origPos = 0;
        topMost = true;
      }
    }

    pattern.origPos = (origPos >= 0 ? origPos : subscription.nextPos++);

    let pos = -1;
    if (pattern.dummy) {
      // Insert dummies at the exact position
      if (topMost)
        pos = 0;
      else
        for (i = 0; i < subscription.patterns.length; i++)
          if (pattern.origPos < subscription.patterns[i].origPos && (pos < 0 || subscription.patterns[i].origPos < subscription.patterns[pos].origPos))
            pos = i;
    }
    else {
      // Insert patterns with respect to sorting
      if (origPos >= 0 || this.sortProc != sortNatural)
        for (i = 0; pos < 0 && i < subscription.patterns.length; i++)
          if (this.sortProc(pattern, subscription.patterns[i]) < 0)
            pos = i;
    }

    if (pos < 0) {
      subscription.patterns.push(pattern);
      pos = subscription.patterns.length - 1;
    }
    else
      subscription.patterns.splice(pos, 0, pattern);

    parentRow = this.getSubscriptionRow(subscription);

    if (subscription.special && subscription.patterns.length == 1) {
      // Show previously invisible subscription
      let count = 1;
      if (!(subscription.url in this.closed))
        count += subscription.extra.length;
      this.boxObject.rowCountChanged(parentRow, count);
    }

    if (!(subscription.url in this.closed))
      this.boxObject.rowCountChanged(parentRow + 1 + subscription.extra.length + pos, 1);

    if (typeof noSelect == "undefined" || !noSelect) {
      if (subscription.url in this.closed)
        this.toggleOpenState(parentRow);
      this.selection.select(parentRow + 1 + subscription.extra.length + pos);
      this.boxObject.ensureRowIsVisible(parentRow + 1 + subscription.extra.length + pos);
    }

    if (text)
      onChange();
  },

  // Removes a pattern by its text
  removePattern: function(text) {
    for (let i = 0; i < this.data.length; i++) {
      if (!this.data[i].special)
        continue;

      for (let j = 0; j < this.data[i].patterns.length; j++)
        if (this.data[i].patterns[j].text == text)
          this.removeRow([this.data[i], this.data[i].patterns[j]]);
    }
  },

  // Removes a pattern or a complete subscription by its info
  removeRow: function(info) {
    if (info[1]) {
      // Not removing description rows or patterns from subscriptions
      if (typeof info[1] == "string" || !info[0].special)
        return;

      // Remove a single pattern
      for (let i = 0; i < info[0].patterns.length; i++) {
        if (info[0].patterns[i] == info[1]) {
          let parentRow = this.getSubscriptionRow(info[0]);
          info[0].patterns.splice(i, 1);

          let newSelection = parentRow;
          if (!(info[0].url in this.closed)) {
            this.boxObject.rowCountChanged(parentRow + 1 + info[0].extra.length + i, -1);
            newSelection = parentRow + 1 + info[0].extra.length + i;
          }

          if (info[0].special && !info[0].patterns.length) {
            // Don't show empty special subscriptions
            let count = 1;
            if (!(info[0].url in this.closed))
              count += info[0].extra.length;
            this.boxObject.rowCountChanged(parentRow, -count);
            newSelection -= count;
          }

          this.ensureSelection(newSelection);
          if (!info[1].dummy)
            onChange();
          return;
        }
      }
    }
    else {
      // Not removing special groups
      if (info[0].special)
        return;

      // Remove a complete subscription
      for (i = 0; i < this.data.length; i++) {
        if (this.data[i] == info[0]) {
          let firstRow = this.getSubscriptionRow(info[0]);
          count = 1;
          if (!(info[0].url in this.closed))
            count += info[0].extra.length + info[0].patterns.length;

          this.data.splice(i, 1);
          this.boxObject.rowCountChanged(firstRow, -count);

          this.ensureSelection(firstRow);
          onChange();
          return;
        }
      }
    }
  },

  moveRow: function(info, offset) {
    if (info[1] && typeof info[1] != "string") {
      if (this.isSorted() || !info[0].special)
        return;

      // Swapping two patterns within a subscription
      let subscription = info[0];
      let index = -1;
      for (let i = 0; i < subscription.patterns.length; i++)
        if (subscription.patterns[i] == info[1])
          index = i;

      if (index < 0)
        return;

      if (index + offset < 0)
        offset = -index;
      if (index + offset > subscription.patterns.length - 1)
        offset = subscription.patterns.length - 1 - index;

      if (offset == 0)
        return;

      let step = (offset < 0 ? -1 : 1);
      for (i = index + step; i != index + offset + step; i += step) {
        let tmp = subscription.patterns[i].origPos;
        subscription.patterns[i].origPos = subscription.patterns[i - step].origPos;
        subscription.patterns[i - step].origPos = tmp;
  
        tmp = subscription.patterns[i];
        subscription.patterns[i] = subscription.patterns[i - step];
        subscription.patterns[i - step] = tmp;
      }

      let parentRow = this.getSubscriptionRow(subscription);
      let row, row1, row2;
      row1 = row2 = parentRow + 1 + subscription.extra.length + index;
      if (offset < 0)
        row = row1 += offset;
      else
        row = row2 += offset;
      this.boxObject.invalidateRange(row1, row2);

      this.selection.select(row);
      this.boxObject.ensureRowIsVisible(row);
    }
    else {
      // Moving a subscription
      let index = -1;
      for (i = 0; i < this.data.length; i++)
        if (this.data[i] == info[0])
          index = i;

      if (index < 0)
        return;

      let step = (offset < 0 ? -1 : 1);
      let current = index;
      for (i = index + step; i >= 0 && i < this.data.length && offset != 0; i += step) {
        // Ignore invisible groups
        if (this.data[i].dummy || (this.data[i].special && this.data[i].patterns.length == 0))
          continue;

        tmp = this.data[i];
        this.data[i] = this.data[current];
        this.data[current] = tmp;

        current = i;
        offset -= step;
      }

      // No movement - can return here
      if (current == index)
        return;

      let startIndex = Math.min(current, index);
      let endIndex = Math.max(current, index)
      let startRow = this.getSubscriptionRow(this.data[startIndex]);
      let endRow = this.getSubscriptionRow(this.data[endIndex]) + 1;
      if (!(this.data[endIndex].url in this.closed))
        endRow += this.data[endIndex].extra.length + this.data[endIndex].patterns.length;

      this.boxObject.invalidateRange(startRow, endRow);
      this.selection.select(this.getSubscriptionRow(info[0]));
      this.boxObject.ensureRowIsVisible(this.getSubscriptionRow(info[0]));
    }
    onChange();
  },

  dragData: null,
  startDrag: function(row) {
    let info = this.getRowInfo(row);
    if (!info || info[0].dummy || (info[1] && info[1].dummy))
      return;

    let array = Components.classes["@mozilla.org/supports-array;1"]
                          .createInstance(Components.interfaces.nsISupportsArray);
    let transferable = Components.classes["@mozilla.org/widget/transferable;1"]
                                 .createInstance(Components.interfaces.nsITransferable);
    let data = Components.classes["@mozilla.org/supports-string;1"]
                         .createInstance(Components.interfaces.nsISupportsString);
    if (info[1] && typeof info[1] != "string")
      data.data = info[1].text;
    else
      data.data = info[0].title;
    transferable.setTransferData("text/unicode", data, data.data.length * 2);
    array.AppendElement(transferable);

    let region = Components.classes["@mozilla.org/gfx/region;1"]
                           .createInstance(Components.interfaces.nsIScriptableRegion);
    region.init();
    let x = {};
    let y = {};
    let width = {};
    let height = {};
    let col = this.boxObject.columns.getPrimaryColumn();
    this.boxObject.getCoordsForCellItem(row, col, "text", x, y, width, height);
    region.setToRect(x.value, y.value, width.value, height.value);

    if (info[1] && typeof info[1] != "string") {
      if (!info[0].special || this.isSorted())
        return;
    }
    else
      info[1] = null;

    this.dragData = info;

    // This will through an exception if the user cancels D&D
    try {
      dragService.invokeDragSession(this.boxObject.treeBody, array, region, dragService.DRAGDROP_ACTION_MOVE);
    } catch(e) {}
  },

  toggleDisabled: function(row, forceValue) {
    let info = treeView.getRowInfo(row);
    if (!info || typeof info[1] == "string" || (!info[1] && info[0].special) || info[0].dummy)
      return forceValue;
    if (info[1] && (info[1].type == "comment" || info[1].type == "invalid" || info[1].dummy))
      return forceValue;
    if (info[1] && !info[0].special && info[0].disabled)
      return forceValue;

    if (info[1]) {
      if (typeof forceValue == "undefined")
        forceValue = !(info[1].text in this.disabled);

      if (forceValue)
        this.disabled[info[1].text] = true;
      else
        delete this.disabled[info[1].text];

      this.invalidatePattern(info[1]);
    }
    else {
      if (typeof forceValue == "undefined")
        forceValue = !info[0].disabled;

      info[0].disabled = forceValue;

      let min = this.boxObject.getFirstVisibleRow();
      let max = this.boxObject.getLastVisibleRow();
      for (let i = min; i <= max; i++) {
        let rowInfo = this.getRowInfo(i);
        if (rowInfo && rowInfo[0] == info[0])
          this.boxObject.invalidateRow(i);
      }
    }
    onChange();
    return forceValue;
  },

  invalidatePattern: function(pattern) {
    let min = this.boxObject.getFirstVisibleRow();
    let max = this.boxObject.getLastVisibleRow();
    for (let i = min; i <= max; i++) {
      let rowInfo = this.getRowInfo(i);
      if (rowInfo && rowInfo[1] && typeof rowInfo[1] != "string" && rowInfo[1].text == pattern.text)
        this.boxObject.invalidateRow(i);
    }
  },

  invalidateSubscription: function(subscription, origRow, origRowCount) {
    let row = this.getSubscriptionRow(subscription);
    if (row < 0)
      row = origRow;

    let rowCount = this.getSubscriptionRowCount(subscription);

    if (rowCount != origRowCount)
      this.boxObject.rowCountChanged(row + Math.min(rowCount, origRowCount), rowCount - origRowCount);

    this.boxObject.invalidateRange(row, row + Math.min(rowCount, origRowCount) - 1);
  },

  invalidateSubscriptionInfo: function(subscription) {
    let row = this.getSubscriptionRow(subscription);
    this.boxObject.invalidateRange(row, row + subscription.extra.length);
  },

  removeUserPatterns: function() {
    for (let i = 0; i < this.data.length; i++) {
      let subscription = this.data[i];
      if (subscription.special && subscription.patterns.length) {
        let row = this.getSubscriptionRow(subscription);
        let count = 1;
        if (!(subscription.url in this.closed))
          count += subscription.extra.length + subscription.patterns.length;

        subscription.patterns = [];
        this.boxObject.rowCountChanged(row, -count);

        onChange();
      }
    }
    this.ensureSelection(0);
  },

  applyChanges: function() {
    prefs.userPatterns = [];
    prefs.subscriptions = [];
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i].dummy)
        continue;

      let list = prefs.userPatterns;
      let subscription = prefs.knownSubscriptions[this.data[i].url];
      if (!subscription.special) {
        subscription.title = this.data[i].title;
        subscription.autoDownload = this.data[i].autoDownload;
        subscription.disabled = this.data[i].disabled;
        list = subscription.patterns = [];
      }
      prefs.subscriptions.push(subscription);

      let patterns = this.data[i].patterns.slice();
      patterns.sort(sortNatural);
      for (let j = 0; j < patterns.length; j++) {
        let pattern = patterns[j].orig;
        pattern.disabled = pattern.text in this.disabled;
        list.push(pattern);
      }
    }
    prefs.initMatching();
    prefs.savePatterns();
  },

  find: function(text, direction, highlightAll) {
    text = text.toLowerCase();

    let match = [null, null, null, null, null];
    let current = this.getRowInfo(this.selection.currentIndex);
    let isCurrent = false;
    let foundCurrent = !current;
    if (highlightAll) {
      this.selection.clearSelection();
      let rowCache = {__proto__: null};
    }

    let selectMatch = function(subscription, offset) {
      if (highlightAll) {
        let row = (subscription.url in rowCache ? rowCache[subscription.url] : treeView.getSubscriptionRow(subscription));
        rowCache[subscription.url] = row;
        if (offset && subscription.url in treeView.closed)
          treeView.toggleOpenState(row);
        treeView.selection.rangedSelect(row + offset, row + offset, true);
      }

      let index = (isCurrent ? 2 : (foundCurrent ?  4 : 1));
      match[index] = [subscription, offset];
      if (index != 2 && !match[index - 1])
        match[index - 1] = match[index];
    };

    for (let i = 0; i < this.data.length; i++) {
      let subscription = this.data[i];
      if (subscription.special && subscription.patterns.length == 0)
        continue;

      isCurrent = (current && subscription == current[0] && !current[1]);
      if (subscription.title.toLowerCase().indexOf(text) >= 0)
        selectMatch(subscription, 0);
      if (isCurrent)
        foundCurrent = true;

      for (let j = 0; j < subscription.extra.length; j++) {
        let descr = subscription.extra[j];
        isCurrent = (current && subscription == current[0] && current[1] == descr);
        if (descr.toLowerCase().indexOf(text) >= 0)
          selectMatch(subscription, 1 + j);
        if (isCurrent)
          foundCurrent = true;
      }

      for (j = 0; j < subscription.patterns.length; j++) {
        let pattern = subscription.patterns[j];
        isCurrent = (current && subscription == current[0] && current[1] == pattern);
        if (pattern.text.toLowerCase().indexOf(text) >= 0)
          selectMatch(subscription, 1 + subscription.extra.length + j);
        if (isCurrent)
          foundCurrent = true;
      }
    }

    let found = null;
    let status = "";
    if (direction == 0)
      found = match[2] || match[3] || match[0];
    else if (direction > 0)
      found = match[3] || match[0] || match[2];
    else
      found = match[1] || match[4] || match[2];

    if (!found)
      return "NotFound";

    let row = this.getSubscriptionRow(found[0]);
    if (found[1] && found[0].url in this.closed)
      this.toggleOpenState(row);
    if (highlightAll)
      this.selection.currentIndex = row + found[1];
    else
      this.selection.select(row + found[1]);
    this.boxObject.ensureRowIsVisible(row + found[1]);

    if (direction == -1 && found != match[1])
      return "WrappedToBottom";
    if ((direction == 1 && found != match[3]) || (direction == 0 && match == match[0]))
      return "WrappedToTop";

    return null;
  },

  //
  // Inline pattern editor
  //

  editor: null,
  editorParent: null,
  editedRow: -1,
  editorKeyPressHandler: null,
  editorBlurHandler: null,
  editorCancelHandler: null,
  editorDummyInit: "",

  setEditor: function(editor, editorParent) {
    this.editor = editor;
    this.editorParent = editorParent;

    let me = this;
    this.editorKeyPressHandler = function(e) {
      if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER) {
        me.stopEditor(true);
        if (e.ctrlKey || e.altKey || e.metaKey)
          document.documentElement.acceptDialog();
        else {
          e.preventDefault();
          e.stopPropagation();
        }
      }
      else if (e.keyCode == e.DOM_VK_CANCEL || e.keyCode == e.DOM_VK_ESCAPE) {
        me.stopEditor(false);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    this.editorBlurHandler = function(e) {
      setTimeout(function() {
        let focused = document.commandDispatcher.focusedElement;
        if (!focused || focused != me.editor.field)
          me.stopEditor(true, true);
      }, 0);
    };

    // Prevent cyclic references through closures
    editor = null;
    editorParent = null;
  },

  isEditing: function() {
    return (this.editedRow >= 0);
  },

  startEditor: function() {
    this.stopEditor(false);

    let row = this.selection.currentIndex;
    let info = this.getRowInfo(row);
    let isDummy = info && (info[0].dummy || (info[1] && info[1].dummy));
    if (!isDummy && (!info || !info[0].special || !info[1] || typeof info[1] == "string"))
      return false;

    let col = this.boxObject.columns.getPrimaryColumn();
    let cellX = {};
    let cellY = {};
    let cellWidth = {};
    let cellHeight = {};
    this.boxObject.ensureRowIsVisible(row);
    this.boxObject.getCoordsForCellItem(row, col, "cell", cellX, cellY, cellWidth, cellHeight);

    let textX = {};
    this.boxObject.getCoordsForCellItem(row, col, "text", textX, {}, {}, {});
    cellWidth.value -= textX.value - cellX.value;
    cellX.value = textX.value;

    // Need to translate coordinates so that they are relative to <stack>, not <treechildren>
    let treeBody = this.boxObject.treeBody;
    let editorStack = this.editorParent.parentNode;
    cellX.value += treeBody.boxObject.x - editorStack.boxObject.x;
    cellY.value += treeBody.boxObject.y - editorStack.boxObject.y;

    this.selection.clearSelection();

    this.editedRow = row;
    this.editorParent.hidden = false;
    this.editorParent.width = cellWidth.value;
    this.editorParent.height = this.editor.height;
    this.editorParent.left = cellX.value;
    this.editorParent.top = Math.round(cellY.value + (cellHeight.value - this.editor.height)/2);

    let text = (isDummy ? this.editorDummyInit : info[1].text);

    // Firefox 2 needs time to initialize the text field
    setTimeout(function(me) {
      me.editor.focus();
      me.editor.field = document.commandDispatcher.focusedElement;
      me.editor.field.value = text;
      me.editor.field.setSelectionRange(me.editor.value.length, me.editor.value.length);

      // Need to attach handlers to the embedded html:input instead of menulist - won't catch blur otherwise
      me.editor.field.addEventListener("keypress", me.editorKeyPressHandler, false);
      me.editor.field.addEventListener("blur", me.editorBlurHandler, false);

      me.boxObject.invalidateRow(row);
    }, 0, this);

    return true;
  },

  stopEditor: function(save, blur) {
    if (this.editedRow < 0)
      return;

    this.editor.field.removeEventListener("keypress", this.editorKeyPressHandler, false);
    this.editor.field.removeEventListener("blur", this.editorBlurHandler, false);

    let text = abp.normalizeFilter(this.editor.value);
    if (typeof blur == "undefined" || !blur)
      this.boxObject.treeBody.parentNode.focus();

    let info = this.getRowInfo(this.editedRow);
    let isDummy = info && (info[0].dummy || (info[1] && info[1].dummy));

    if (save) {
      if (text && (isDummy || text != info[1].text)) {
        if (!isDummy || this.editedRow != 0)
          this.removeRow(info);

        if (info[1])
          this.addPattern(text, info[0], info[1].origPos);
        else
          this.addPattern(text);
      }
      else
        save = false;
    }

    if (!save) {
      if (isDummy && this.editedRow != 0)
        this.removeRow(info);
      else
        this.selection.select(this.editedRow);
    }

    if (save)
      onChange();

    this.editor.field.value = "";
    this.editorParent.hidden = true;

    this.editedRow = -1;
    this.editorDummyInit = (save ? "" : text);
  }
};
