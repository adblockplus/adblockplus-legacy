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
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

#include <windows.h>

#define KMELEON_PLUGIN_EXPORTS
#include "KMeleonConst.h"
#include "kmeleon_plugin.h"
#include "Utils.h"

#define MOZILLA_STRICT_API
#include "nsISupports.h"
#include "nsCOMPtr.h"
#include "nsComponentManagerUtils.h"
#include "nsServiceManagerUtils.h"
#include "nsIInterfaceRequestorUtils.h"
#include "nsIObserver.h"
#include "nsIDOMWindow.h"
#include "nsIDOMWindowInternal.h"
#include "nsPIDOMWindow.h"
#include "nsIEmbeddingSiteWindow.h"
#include "nsIXPConnect.h"
#include "nsIDOMEvent.h"
#include "nsIDOMEventTarget.h"
#include "nsIDOMEventListener.h"
#include "nsIChromeEventHandler.h"
#include "nsIURI.h"
#include "nsIXPCScriptable.h"
#include "nsIPrefService.h"
#include "nsIPrefBranch.h"
#include "nsIConsoleService.h"
#include "nsIScriptError.h"
#include "nsIScriptSecurityManager.h"
#include "nsIPrincipal.h"
#include "imgIRequest.h"
#include "imgILoader.h"
#include "imgIDecoderObserver.h"
#include "gfxIImageFrame.h"
#include "nsIIOService.h"
#include "nsIComponentRegistrar.h"
#include "nsIProperties.h"
#include "nsDirectoryServiceDefs.h"
#include "nsILocalFile.h"
#include "nsIJSContextStack.h"
#include "nsXPCOM.h"
#include "nsEmbedString.h"
#include "jsapi.h"
#include "prmem.h"

#define PLUGIN_NAME "Adblock Plus " ABP_VERSION
#define ADBLOCKPLUS_CONTRACTID "@mozilla.org/adblockplus;1"

enum {CMD_PREFERENCES, CMD_LISTALL, CMD_TOGGLEENABLED, CMD_IMAGE, CMD_OBJECT, CMD_FRAME, CMD_SEPARATOR, CMD_TOOLBAR, CMD_STATUSBAR, NUM_COMMANDS};
enum {LABEL_CONTEXT_IMAGE, LABEL_CONTEXT_OBJECT, LABEL_CONTEXT_FRAME, NUM_LABELS};

class abpScriptable : public nsIXPCScriptable {
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIXPCSCRIPTABLE
};

class abpListener : public nsIDOMEventListener {
public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIDOMEVENTLISTENER
};

class abpImgObserver : public imgIDecoderObserver {
public:
  NS_DECL_ISUPPORTS
  NS_DECL_IMGIDECODEROBSERVER
  NS_DECL_IMGICONTAINEROBSERVER
};

class abpJSContextHolder {
public:
  abpJSContextHolder();
  ~abpJSContextHolder();

  JSContext* get() {
    return mContext;
  }
private:
  nsCOMPtr<nsIThreadJSContextStack> mStack;
  JSContext* mContext;
  JSErrorReporter mOldReporter;
};

template<class T>
class abpList {
public:
  abpList() : buffer(nsnull), entries(0), bufSize(0) {}
  virtual ~abpList() {
    if (buffer != nsnull)
      PR_Free(buffer);
  }

protected:
  void addEntry(T& entry) {
    for (int i = 0; i < entries; i++) {
      if (!buffer[i].used) {
        buffer[i].used = PR_TRUE;
        buffer[i].data = entry;
        return;
      }
    }

    if (entries + 1 > bufSize) {
      bufSize += 8;
      if (buffer == nsnull)
        buffer = NS_STATIC_CAST(entryType*, PR_Malloc(bufSize * sizeof(entryType)));
      else
        buffer = NS_STATIC_CAST(entryType*, PR_Realloc(buffer, bufSize * sizeof(entryType)));
    }

    buffer[entries].used = PR_TRUE;
    buffer[entries].data = entry;
    entries++;
  }

  void removeEntry(int index) {
    buffer[index].used = PR_FALSE;
  }

  int getFirstIndex() {
    return getNextIndex(-1);
  }

  int getNextIndex(int index) {
    for (index++; index < entries; index++)
      if (buffer[index].used)
        return index;

    return -1;
  }

  T& getEntry(int index) {
    return buffer[index].data;
  }
private:
  typedef struct {
    PRBool used;
    T data;
  } entryType;

  int entries;
  int bufSize;
  entryType* buffer;
};

typedef struct {
  HWND hWnd;
  HWND hRebar;
  HWND hToolbar;
} ToolbarDataEntry;

class abpToolbarDataList : public abpList<ToolbarDataEntry> {
public:
  abpToolbarDataList() : currentIcon(3) {}
  void init(WORD command) {
    this->command = command;
  }

  void addToolbar(HWND hToolbar, HWND hRebar) {
    ToolbarDataEntry entry = {GetTopWindow(hRebar), hRebar, hToolbar};
    addEntry(entry);
  }

  void removeWindow(HWND hWnd) {
    for (int i = getFirstIndex(); i >= 0; i = getNextIndex(i))
      if (getEntry(i).hWnd == hWnd)
        removeEntry(i);
  }

  void invalidateToolbars() {
    for (int i = getFirstIndex(); i >= 0; i = getNextIndex(i))
      InvalidateRect(getEntry(i).hToolbar, NULL, TRUE);
  }

  void setToolbarIcon(int icon) {
    currentIcon = icon;

    for (int i = getFirstIndex(); i >= 0; i = getNextIndex(i))
      SendMessage(getEntry(i).hToolbar, TB_CHANGEBITMAP, command, MAKELPARAM(currentIcon, 0));
  }
private:
  int currentIcon;
  WORD command;
  REBARINFO info;
};

typedef void(*addStatusIconFunc)(HWND hWnd, int id, HICON hIcon, const char* tpText);
typedef void(*removeStatusIconFunc)(HWND hWnd, int id);

class abpStatusBarList : public abpList<HWND> {
public:
  abpStatusBarList() : currentIcon(3), hidden(JS_FALSE) {}
  void init(HIMAGELIST hImages, WORD command, addStatusIconFunc addFunc, removeStatusIconFunc removeFunc) {
    this->hImages = hImages;
    this->command = command;
    this->addFunc = addFunc;
    this->removeFunc = removeFunc;
  }
  
  void addStatusBar(HWND hWnd) {
    addEntry(hWnd);
    if (!hidden)
      addFunc(hWnd, command, ImageList_GetIcon(hImages, currentIcon, ILD_TRANSPARENT), NULL);
  }

  void removeStatusBar(HWND hWnd) {
    for (int i = getFirstIndex(); i >= 0; i = getNextIndex(i))
      if (getEntry(i) == hWnd)
        removeEntry(i);

    if (!hidden)
      removeFunc(hWnd, command);
  }

  void invalidateStatusBars() {
    setStatusIcon(-1);
  }

  void setStatusIcon(int icon) {
    if (icon == currentIcon)
      return;

    if (icon >= 0)
      currentIcon = icon;

    if (hidden)
      return;

    for (int i = getFirstIndex(); i >= 0; i = getNextIndex(i)) {
      HWND hWnd = getEntry(i);
      removeFunc(hWnd, command);
      addFunc(hWnd, command, ImageList_GetIcon(hImages, currentIcon, ILD_TRANSPARENT), NULL);
    }
  }

  void setHidden(JSBool hide) {
    if (hide == hidden)
      return;

    hidden = hide;
    if (hidden) {
      for (int i = getFirstIndex(); i >= 0; i = getNextIndex(i))
        removeFunc(getEntry(i), command);
    }
    else {
      for (int i = getFirstIndex(); i >= 0; i = getNextIndex(i))
        addFunc(getEntry(i), command, ImageList_GetIcon(hImages, currentIcon, ILD_TRANSPARENT), NULL);
    }
  }
private:
  HIMAGELIST hImages;
  WORD command;
  addStatusIconFunc addFunc;
  removeStatusIconFunc removeFunc;
  int currentIcon;
  JSBool hidden;
};

// callbacks.cpp
extern WNDPROC origWndProc;
extern WNDPROC origDialogWndProc;
extern HHOOK hook;

LRESULT CALLBACK WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam);
LRESULT CALLBACK DialogWndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam);
LRESULT CALLBACK HookProc(int nCode, WPARAM wParam, LPARAM lParam);

// imgobserver.cpp
extern nsCOMPtr<abpImgObserver> imgObserver;

// initialization.cpp
extern abpToolbarDataList toolbarList;
extern abpStatusBarList statusbarList;
extern nsCOMPtr<nsIDOMWindowInternal> fakeBrowserWindow;
extern WORD cmdBase;
extern char labelValues[NUM_LABELS][100];

PRBool Load();
JSObject* GetComponentObject(JSContext* cx);
PRBool CreateFakeBrowserWindow(JSContext* cx, JSObject* parent, nsIPrincipal* systemPrincipal);

// jsdefs.cpp
extern JSFunctionSpec window_methods[];
extern JSPropertySpec window_properties[];

JSBool JS_DLL_CALLBACK JSAlert(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSSetIcon(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSHideStatusBar(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSOpenTab(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSResetContextMenu(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSAddContextMenuItem(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSCreateCommandID(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSCreatePopupMenu(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSAddMenuItem(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSGetHWND(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSSubclassDialogWindow(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSAddRootListener(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSRemoveRootListener(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSFocusWindow(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSSetTopmostWindow(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSShowToolbarContext(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval);
JSBool JS_DLL_CALLBACK JSGetScriptable(JSContext *cx, JSObject *obj, jsval id, jsval *vp);

// jstools.cpp
JS_STATIC_DLL_CALLBACK(void) Reporter(JSContext *cx, const char *message, JSErrorReport *rep);

// listener.cpp
extern nsCOMPtr<abpListener> listener;

// misc.cpp
JSObject* UnwrapJSObject(nsISupports* native);
nsISupports* UnwrapNative(JSContext* cx, JSObject* obj);
void OpenTab(const char* url, HWND hWnd);
void ShowContextMenu(HWND hWnd, PRBool status);
WNDPROC SubclassWindow(HWND hWnd, WNDPROC newWndProc);

// plugindefs.cpp
extern kmeleonFunctions* kFuncs;
extern kmeleonPlugin kPlugin;
extern HIMAGELIST hImages;
extern int currentImage;

LONG DoMessage(LPCSTR to, LPCSTR from, LPCSTR subject, LONG data1, LONG data2);
void Setup();
void Quit();
void Create(HWND parent);
void Close(HWND parent);
void Config(HWND parent);
void DoMenu(HMENU menu, LPSTR action, LPSTR string);
INT DoAccel(LPSTR action);
void DoRebar(HWND hRebar);
void ReadAccelerator(nsIPrefBranch* branch, const char* pref, const char* command);
void LoadImage();
void DoneLoadingImage();
INT CommandByName(LPCSTR action);

// scriptable.cpp
extern nsCOMPtr<abpScriptable> scriptable;

// inline_scripts.cpp
extern char* includes[];
