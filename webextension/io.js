/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2017 eyeo GmbH
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

(function(exports)
{
  const keyPrefix = "file:";

  function fileToKey(fileName)
  {
    return keyPrefix + fileName;
  }

  function loadFile(file)
  {
    let key = fileToKey(file);

    return browser.storage.local.get(key).then(items =>
    {
      if (items.hasOwnProperty(key))
        return items[key];

      throw "NoSuchFile";
    });
  }

  function saveFile(file, data)
  {
    return browser.storage.local.set({
      [fileToKey(file)]: {
        content: Array.from(data),
        lastModified: Date.now()
      }
    });
  }

  function removeFile(file)
  {
    return browser.storage.local.remove(fileToKey(file));
  }

  exports.IO =
  {
    readFromFile(file)
    {
      return loadFile(file).then(entry =>
      {
        return entry.content;
      });
    },

    writeToFile(file, data)
    {
      return saveFile(file, data);
    },

    copyFile(fromFile, toFile)
    {
      return loadFile(fromFile).then(entry =>
      {
        return saveFile(toFile, entry.content);
      });
    },

    renameFile(fromFile, newName)
    {
      return loadFile(fromFile).then(entry =>
      {
        return browser.storage.local.set({
          [fileToKey(newName)]: entry
        });
      }).then(() =>
      {
        return removeFile(fromFile);
      });
    },

    removeFile(file)
    {
      return removeFile(file);
    },

    statFile(file)
    {
      return loadFile(file).then(entry =>
      {
        return {
          exists: true,
          lastModified: entry.lastModified
        };
      });
    }
  };
})(this);
