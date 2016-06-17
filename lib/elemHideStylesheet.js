/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

let {port} = require("messaging");
let {ElemHide} = require("elemHide");
let {FilterNotifier} = require("filterNotifier");
let {Prefs} = require("prefs");
let {Utils} = require("utils");

/**
 * Indicates whether the element hiding stylesheet is currently applied.
 * @type Boolean
 */
let applied = false;

/**
 * Stylesheet URL to be registered
 * @type nsIURI
 */
let styleURL = Utils.makeURI("about:abp-elemhide?css");

function init()
{
  port.on("getSelectors", () => ElemHide.getSelectors());

  apply();
  onShutdown.add(unapply);

  Prefs.addListener(function(name)
  {
    if (name == "enabled")
      apply();
  });

  FilterNotifier.on("elemhideupdate", onUpdate);
}

function onUpdate()
{
  // Call apply() asynchronously and protect against reentrance - multiple
  // change events shouldn't result in multiple calls.
  if (onUpdate.inProgress)
    return;

  onUpdate.inProgress = true;
  Utils.runAsync(() =>
  {
    onUpdate.inProgress = false;
    apply();
  });
}

function apply()
{
  unapply();

  if (!Prefs.enabled)
    return;

  try
  {
    Utils.styleService.loadAndRegisterSheet(styleURL,
        Ci.nsIStyleSheetService.USER_SHEET);
    applied = true;
  }
  catch (e)
  {
    Cu.reportError(e);
  }
}

function unapply()
{
  if (applied)
  {
    try
    {
      Utils.styleService.unregisterSheet(styleURL,
          Ci.nsIStyleSheetService.USER_SHEET);
    }
    catch (e)
    {
      Cu.reportError(e);
    }
    applied = false;
  }
}

// Send dummy message before initializing, this delay makes sure that the child
// modules are loaded and our protocol handler registered.
port.emitWithResponse("ping").then(init);
