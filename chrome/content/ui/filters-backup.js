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
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * Implementation of backup and restore functionality.
 * @class
 */
var Backup =
{
  /**
   * Template for menu items to be displayed in the Restore menu (for automated
   * backups).
   * @type Element
   */
  restoreTemplate: null,

  /**
   * Element after which restore items should be inserted.
   * @type Element
   */
  restoreInsertionPoint: null,

  /**
   * Regular expression to recognize checksum comments.
   */
  CHECKSUM_REGEXP: /^!\s*checksum[\s\-:]+([\w\+\/]+)/i,

  /**
   * Regular expression to recognize group title comments.
   */
  GROUPTITLE_REGEXP: /^!\s*\[(.*)\]((?:\/\w+)*)\s*$/,


  /**
   * Initializes backup UI.
   */
  init: function()
  {
    this.restoreTemplate = E("restoreBackupTemplate");
    this.restoreInsertionPoint = this.restoreTemplate.previousSibling;
    this.restoreTemplate.parentNode.removeChild(this.restoreTemplate);
    this.restoreTemplate.removeAttribute("id");
    this.restoreTemplate.removeAttribute("hidden");
  },

  /**
   * Gets the default download dir, as used by the browser itself.
   */
  getDefaultDir: function() /**nsIFile*/
  {
    try
    {
      return Utils.prefService.getComplexValue("browser.download.lastDir", Ci.nsILocalFile);
    }
    catch (e)
    {
      // No default download location. Default to desktop.
      return Utils.dirService.get("Desk", Ci.nsILocalFile);
    }
  },

  /**
   * Saves new default download dir after the user chose a different directory to
   * save his files to.
   */
  saveDefaultDir: function(/**nsIFile*/ dir)
  {
    try
    {
      Utils.prefService.setComplexValue("browser.download.lastDir", Ci.nsILocalFile, dir);
    } catch(e) {};
  },

  /**
   * Called when the Restore menu is being opened, fills in "Automated backup"
   * entries.
   */
  fillRestorePopup: function()
  {
    while (this.restoreInsertionPoint.nextSibling && !this.restoreInsertionPoint.nextSibling.id)
      this.restoreInsertionPoint.parentNode.removeChild(this.restoreInsertionPoint.nextSibling);

    let files = FilterStorage.getBackupFiles().reverse();
    for (let i = 0; i < files.length; i++)
    {
      let file = files[i];
      let item = this.restoreTemplate.cloneNode(true);
      let label = item.getAttribute("label");
      label = label.replace(/\?1\?/, Utils.formatTime(file.lastModifiedTime));
      item.setAttribute("label", label);
      item.addEventListener("command", function()
      {
        Backup.restoreAllData(file);
      }, false);
      this.restoreInsertionPoint.parentNode.insertBefore(item, this.restoreInsertionPoint.nextSibling);
    }
  },

  /**
   * Lets the user choose a file to restore filters from.
   */
  restoreFromFile: function()
  {
    let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(window, E("backupButton").getAttribute("_restoreDialogTitle"), picker.modeOpen);
    picker.defaultExtension = ".ini";
    picker.appendFilter(E("backupButton").getAttribute("_fileFilterComplete"), "*.ini");
    picker.appendFilter(E("backupButton").getAttribute("_fileFilterCustom"), "*.txt");

    if (picker.show() != picker.returnCancel)
    {
      this.saveDefaultDir(picker.file.parent);
      if (picker.filterIndex == 0)
        this.restoreAllData(picker.file);
      else
        this.restoreCustomFilters(picker.file);
    }
  },

  /**
   * Restores patterns.ini from a file.
   */
  restoreAllData: function(/**nsIFile*/ file)
  {
    let fileStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
    fileStream.init(file, 0x01, 0444, 0);

    let stream = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);
    stream.init(fileStream, "UTF-8", 16384, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
    stream = stream.QueryInterface(Ci.nsIUnicharLineInputStream);

    let lines = [];
    let line = {value: null};
    if (stream.readLine(line))
      lines.push(line.value);
    if (stream.readLine(line))
      lines.push(line.value);
    stream.close();

    if (lines.length < 2 || lines[0] != "# Adblock Plus preferences" || !/version=(\d+)/.test(lines[1]))
    {
      Utils.alert(window, E("backupButton").getAttribute("_restoreError"), E("backupButton").getAttribute("_restoreDialogTitle"));
      return;
    }

    let warning = E("backupButton").getAttribute("_restoreCompleteWarning");
    let minVersion = parseInt(RegExp.$1, 10);
    if (minVersion > FilterStorage.formatVersion)
      warning += "\n\n" + E("backupButton").getAttribute("_restoreVersionWarning");

    if (!Utils.confirm(window, warning, E("backupButton").getAttribute("_restoreDialogTitle")))
      return;

    FilterStorage.loadFromDisk(file);
  },

  /**
   * Restores custom filters from a file.
   */
  restoreCustomFilters: function(/**nsIFile*/ file)
  {
    let fileStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
    fileStream.init(file, 0x01, 0444, 0);

    let stream = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);
    stream.init(fileStream, "UTF-8", 16384, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
    stream = stream.QueryInterface(Ci.nsIUnicharLineInputStream);

    let lines = [];
    let line = {value: null};
    while (stream.readLine(line))
      lines.push(line.value);
    if (line.value)
      lines.push(line.value);
    stream.close();

    if (!lines.length || !/\[Adblock(?:\s*Plus\s*([\d\.]+)?)?\]/i.test(lines[0]))
    {
      Utils.alert(window, E("backupButton").getAttribute("_restoreError"), E("backupButton").getAttribute("_restoreDialogTitle"));
      return;
    }

    let warning = E("backupButton").getAttribute("_restoreCustomWarning");
    let minVersion = RegExp.$1;
    if (minVersion && Utils.versionComparator.compare(minVersion, Utils.addonVersion) > 0)
      warning += "\n\n" + E("backupButton").getAttribute("_restoreVersionWarning");

    if (!Utils.confirm(window, warning, E("backupButton").getAttribute("_restoreDialogTitle")))
      return;

    let subscriptions = FilterStorage.subscriptions.filter(function(s) s instanceof SpecialSubscription);
    for (let i = 0; i < subscriptions.length; i++)
      FilterStorage.removeSubscription(subscriptions[i]);

    let subscription = null;
    for (let i = 1; i < lines.length; i++)
    {
      if (this.CHECKSUM_REGEXP.test(lines[i]))
        continue;
      else if (this.GROUPTITLE_REGEXP.test(lines[i]))
      {
        if (subscription)
          FilterStorage.addSubscription(subscription);
        subscription = SpecialSubscription.create(RegExp.$1);

        let options = RegExp.$2;
        let defaults = [];
        if (options)
          options = options.split("/");
        for (let j = 0; j < options.length; j++)
          if (options[j] in SpecialSubscription.defaultsMap)
            defaults.push(options[j]);
        if (defaults.length)
          subscription.defaults = defaults;
      }
      else
      {
        let filter = Filter.fromText(Filter.normalize(lines[i]));
        if (!filter)
          continue;
        if (!subscription)
          subscription = SpecialSubscription.create(Utils.getString("blockingGroup_title"));
        subscription.filters.push(filter);
      }
    }
    if (subscription)
      FilterStorage.addSubscription(subscription);
    E("tabs").selectedIndex = 1;
  },

  /**
   * Lets the user choose a file to backup filters to.
   */
  backupToFile: function()
  {
    let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(window, E("backupButton").getAttribute("_backupDialogTitle"), picker.modeSave);
    picker.defaultExtension = ".ini";
    picker.appendFilter(E("backupButton").getAttribute("_fileFilterComplete"), "*.ini");
    picker.appendFilter(E("backupButton").getAttribute("_fileFilterCustom"), "*.txt");

    if (picker.show() != picker.returnCancel)
    {
      this.saveDefaultDir(picker.file.parent);
      if (picker.filterIndex == 0)
        this.backupAllData(picker.file);
      else
        this.backupCustomFilters(picker.file);
    }
  },

  /**
   * Writes all patterns.ini data to a file.
   */
  backupAllData: function(/**nsIFile*/ file)
  {
    FilterStorage.saveToDisk(file);
  },

  /**
   * Writes user's custom filters to a file.
   */
  backupCustomFilters: function(/**nsIFile*/ file)
  {
    let subscriptions = FilterStorage.subscriptions.filter(function(s) s instanceof SpecialSubscription);
    let list = ["[Adblock Plus 2.0]"];
    for (let i = 0; i < subscriptions.length; i++)
    {
      let subscription = subscriptions[i];
      let typeAddition = "";
      if (subscription.defaults)
        typeAddition = "/" + subscription.defaults.join("/");
      list.push("! [" + subscription.title + "]" + typeAddition);
      for (let j = 0; j < subscription.filters.length; j++)
      {
        let filter = subscription.filters[j];
        // Skip checksums
        if (filter instanceof CommentFilter && this.CHECKSUM_REGEXP.test(filter.text))
          continue;
        // Skip group headers
        if (filter instanceof CommentFilter && this.GROUPTITLE_REGEXP.test(filter.text))
          continue;
        list.push(filter.text);
      }
    }

    // Insert checksum
    let checksum = Utils.generateChecksum(list);
    if (checksum)
      list.splice(1, 0, "! Checksum: " + checksum);

    try
    {
      let fileStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      fileStream.init(file, 0x02 | 0x08 | 0x20, 0644, 0);

      let stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
      stream.init(fileStream, "UTF-8", 16384, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

      stream.writeString(list.join(Utils.getLineBreak()));

      stream.close();
    }
    catch (e)
    {
      Cu.reportError(e);
      Utils.alert(window, E("backupButton").getAttribute("_backupError"), E("backupButton").getAttribute("_backupDialogTitle"));
    }
  }
};

window.addEventListener("load", function()
{
  Backup.init();
}, false);
