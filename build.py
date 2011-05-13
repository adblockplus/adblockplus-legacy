#!/usr/bin/env python
# coding: utf-8

import os, sys, subprocess

if not os.path.exists('buildtools'):
  subprocess.Popen(['hg', 'clone', 'https://hg.adblockplus.org/buildtools/']).communicate()

import buildtools.build
buildtools.build.processArgs('.', sys.argv)
