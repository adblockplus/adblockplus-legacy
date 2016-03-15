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

/**
 * @fileOverview Collects some data for a content window, to be attached to
 * issue reports.
 */

"use strict";

let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});
let {Task} = Cu.import("resource://gre/modules/Task.jsm", {});
let {PrivateBrowsingUtils} = Cu.import("resource://gre/modules/PrivateBrowsingUtils.jsm", {});

let {port} = require("messaging");
let {Utils} = require("utils");

port.on("collectData", onCollectData);

function onCollectData({outerWindowID, screenshotWidth}, sender)
{
  let window = Services.wm.getOuterWindowWithId(outerWindowID);
  if (window)
  {
    return Task.spawn(function*()
    {
      let data = {};
      data.isPrivate = PrivateBrowsingUtils.isContentWindowPrivate(window);
      data.opener = window.opener ? window.opener.location.href : null;
      data.referrer = window.document.referrer;
      data.frames = yield scanFrames(window);
      data.screenshot = yield createScreenshot(window, screenshotWidth);
      return data;
    });
  }
}

function scanFrames(window)
{
  let frames = [];
  for (let i = 0; i < window.frames.length; i++)
  {
    let frame = window.frames[i];
    frames.push({
      url: frame.location.href,
      frames: scanFrames(frame)
    });
  }
  return frames;
}

function* createScreenshot(window, screenshotWidth)
{
  let canvas = window.document.createElement("canvas");
  canvas.width = screenshotWidth;

  let context = canvas.getContext("2d");
  let wndWidth = window.document.documentElement.scrollWidth;
  let wndHeight = window.document.documentElement.scrollHeight;

  // Copy scaled screenshot of the webpage, according to the specified width.

  // Gecko doesn't like sizes more than 64k, restrict to 30k to be on the safe side.
  // Also, make sure height is at most five times the width to keep image size down.
  let copyWidth = Math.min(wndWidth, 30000);
  let copyHeight = Math.min(wndHeight, 30000, copyWidth * 5);
  let copyX = Math.max(Math.min(window.scrollX - copyWidth / 2, wndWidth - copyWidth), 0);
  let copyY = Math.max(Math.min(window.scrollY - copyHeight / 2, wndHeight - copyHeight), 0);

  let scalingFactor = screenshotWidth / copyWidth;
  canvas.height = copyHeight * scalingFactor;

  context.save();
  context.scale(scalingFactor, scalingFactor);
  context.drawWindow(window, copyX, copyY, copyWidth, copyHeight, "rgb(255,255,255)");
  context.restore();

  // Reduce colors
  let pixelData = context.getImageData(0, 0, canvas.width, canvas.height);
  let data = pixelData.data;
  let mapping = [0x00,  0x55,  0xAA,  0xFF];
  for (let i = 0; i < data.length; i++)
  {
    data[i] = mapping[data[i] >> 6];

    if (i % 5000 == 0)
    {
      // Take a break every 5000 bytes to prevent browser hangs
      yield new Promise((resolve, reject) => Utils.runAsync(resolve));
    }
  }

  return pixelData;
}
