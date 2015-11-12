/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2015 Eyeo GmbH
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

/**
 * @fileOverview Code responsible for showing and hiding object tabs.
 */

let {Prefs} = require("prefs");
let {Utils} = require("utils");

/**
 * Random element class, to be used for object tabs displayed on top of the
 * plugin content.
 * @type string
 */
let classVisibleTop = null;

/**
 * Random element class, to be used for object tabs displayed at the bottom of
 * the plugin content.
 * @type string
 */
let classVisibleBottom = null;

/**
 * Random element class, to be used for object tabs that are hidden.
 * @type string
 */
let classHidden = null;

Utils.addChildMessageListener("AdblockPlus:GetObjectTabsStatus", function()
{
  let {UI} = require("ui");

  return !!(Prefs.enabled && Prefs.frameobjects && UI.overlay && classHidden);
});

Utils.addChildMessageListener("AdblockPlus:GetObjectTabsTexts", function()
{
  let {UI} = require("ui");

  return {
    label: UI.overlay.attributes.objtabtext,
    tooltip: UI.overlay.attributes.objtabtooltip,
    classVisibleTop, classVisibleBottom, classHidden
  };
});

Utils.addChildMessageListener("AdblockPlus:BlockItem", function({request, nodesID})
{
  let {UI} = require("ui");
  UI.blockItem(UI.currentWindow, nodesID, request);
});

function init()
{
  function processCSSData(event)
  {
    if (onShutdown.done)
      return;

    let data = event.target.responseText;

    let rnd = [];
    let offset = "a".charCodeAt(0);
    for (let i = 0; i < 60; i++)
      rnd.push(offset + Math.random() * 26);

    classVisibleTop = String.fromCharCode.apply(String, rnd.slice(0, 20));
    classVisibleBottom = String.fromCharCode.apply(String, rnd.slice(20, 40));
    classHidden = String.fromCharCode.apply(String, rnd.slice(40, 60));

    let url = Utils.makeURI("data:text/css," + encodeURIComponent(data.replace(/%%CLASSVISIBLETOP%%/g, classVisibleTop)
                                                                      .replace(/%%CLASSVISIBLEBOTTOM%%/g, classVisibleBottom)
                                                                      .replace(/%%CLASSHIDDEN%%/g, classHidden)));
    Utils.styleService.loadAndRegisterSheet(url, Ci.nsIStyleSheetService.USER_SHEET);
    onShutdown.add(function()
    {
      Utils.styleService.unregisterSheet(url, Ci.nsIStyleSheetService.USER_SHEET);
    });
  }

  // Load CSS asynchronously
  try
  {
    let request = new XMLHttpRequest();
    request.mozBackgroundRequest = true;
    request.open("GET", "chrome://adblockplus/content/objtabs.css");
    request.overrideMimeType("text/plain");
    request.addEventListener("load", processCSSData, false);
    request.send(null);
  }
  catch (e)
  {
    Cu.reportError(e);
  }
}
init();
