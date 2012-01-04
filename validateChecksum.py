#!/usr/bin/env python
# coding: utf-8

# This Source Code is subject to the terms of the Mozilla Public License
# version 2.0 (the "License"). You can obtain a copy of the License at
# http://mozilla.org/MPL/2.0/.

#############################################################################
# This is a reference script to validate the checksum in downloadable       #
# subscription. This performs the same validation as Adblock Plus when it   #
# downloads the subscription.                                               #
#                                                                           #
# To validate a subscription file, run the script like this:                #
#                                                                           #
#   python validateChecksum.py < subscription.txt                           #
#                                                                           #
# Note: your subscription file should be saved in UTF-8 encoding, otherwise #
# the validation will fail.                                                 #
#                                                                           #
#############################################################################

import sys, re, codecs, hashlib, base64

checksumRegexp = re.compile(r'^\s*!\s*checksum[\s\-:]+([\w\+\/=]+).*\n', re.I | re.M)

def validate(data):
  checksum = extractChecksum(data)
  if not checksum:
    raise Exception('Data doesn\'t contain a checksum, nothing to validate')

  expectedChecksum = calculateChecksum(data)
  if checksum == expectedChecksum:
    print 'Checksum is valid'
  else:
    print 'Wrong checksum: found %s, expected %s' % (checksum, expectedChecksum)

def extractChecksum(data):
  match = re.search(checksumRegexp, data)
  return match.group(1) if match else None

def calculateChecksum(data):
  md5 = hashlib.md5()
  md5.update(normalize(data).encode('utf-8'))
  return base64.b64encode(md5.digest()).rstrip('=')

def normalize(data):
  data = re.sub(r'\r', '', data)
  data = re.sub(r'\n+', '\n', data)
  data = re.sub(checksumRegexp, '', data)
  return data

def readStream(stream):
  reader = codecs.getreader('utf8')(stream)
  try:
    return reader.read()
  except Exception, e:
    raise Exception('Failed reading data, most likely not encoded as UTF-8:\n%s' % e)

if __name__ == '__main__':
  validate(readStream(sys.stdin))
