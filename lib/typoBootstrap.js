/*
 * This file is part of the Adblock Plus,
 * Copyright (C) 2006-2012 Eyeo GmbH
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
 * @fileOverview Adds typo correction feature
 */

Cu.import("resource://gre/modules/AddonManager.jsm");

let {Prefs} = require("prefs");
let urlfixerID = "{0fa2149e-bb2c-4ac2-a8d3-479599819475}";
let addonListener = null;

function init()
{
  if (!Prefs.correctTyposAsked || (Prefs.correctTyposAsked && Prefs.correctTypos))
  {
    AddonManager.getAddonByID(urlfixerID, function(addon)
    {
      startTypoCorrection(addon && addon.isActive);
    });
  }
  else
  {
    let onPrefChange = function(name)
    {
      if (name == "correctTypos" && Prefs[name])
      {
        init();
        Prefs.removeListener(onPrefChange);
      }
    }
    
    Prefs.addListener(onPrefChange);
  }
}

function startTypoCorrection(isInstalledAndEnabled)
{
  if (isInstalledAndEnabled)
    require("typoFixer").detachWindowObserver();
  else
    require("typoFixer").attachWindowObserver();
  
  if (!addonListener)
  {
    addonListener = {
      onEnabling: function(addon, needsRestart)
      {
        if (addon.id == urlfixerID)
          startTypoCorrection(true);
      },
      onDisabled: function(addon)
      {
        if (addon.id == urlfixerID)
          startTypoCorrection(false);
      },
      onInstalling: function(addon, needsRestart)
      {
        if (addon.id == urlfixerID)
          startTypoCorrection(true);
      },
      onUninstalled: function(addon)
      {
        if (addon.id == urlfixerID)
          startTypoCorrection(false);
      }
    }
    
    AddonManager.addAddonListener(addonListener);
    onShutdown.add(function() AddonManager.removeAddonListener(addonListener));
  }
}

init();
