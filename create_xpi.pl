#!/usr/bin/perl

use strict;
use warnings;
use Packager;

my %params = ();

my $xpiFile = shift @ARGV || "adblockplus.xpi";
if (@ARGV && $ARGV[0] =~ /^\+/)
{
  $params{devbuild} = $ARGV[0];
  if ($params{devbuild} =~ /debug$/)
  {
    my $abpPostfix = <<'EOT';
      var logFile = Components.classes["@mozilla.org/file/directory_service;1"]
                              .getService(Components.interfaces.nsIProperties)
                              .get("DrvD", Components.interfaces.nsILocalFile);
      logFile.append("adblockplus.log");
  
      var logFileOutput = Components.classes["@mozilla.org/network/file-output-stream;1"]
                                    .createInstance(Components.interfaces.nsIFileOutputStream);
      logFileOutput.init(logFile, 0x20 | 0x08 | 0x02, 0644, 0);
  
      abp.log = function abpLog(file, line, funcName, args, action) {
        args = Array.prototype.join.call(args, ", ");
        if (args.length > 100)
          args = args.substr(0, 100) + "...";
        var signature = funcName + "(" + args + ")";
        var numFilters = "";
        if (abp && "prefs" in abp && abp.prefs)
          numFilters = " - " + abp.prefs.userPatterns.length + " filters in the list";
        var str = file + " line " + line + ", " + action + " in " + signature + numFilters + "\n";
      
        logFileOutput.write(str, str.length);
      };
EOT
    $abpPostfix =~ s/^\s+//mg;
    $abpPostfix =~ s/[\r\n]//sg;

    my ($curFile, $curFileName, $funcName, $lineNum, $retNum, $throwNum);

    $params{postprocess_line} = sub {
      my ($fileName, $line) = @_;
      return $line unless $fileName =~ /\.js$/;

      local $_ = $line;

      if (!defined($curFile) || $curFile ne $fileName) {
        $curFile = $curFileName = $fileName;
        $curFileName =~ s/.*\///;
        $funcName = '';
        $lineNum = 1;
      }

      if (/function (\w+)\([^)]*\)\s*\{\s*/ || /(\w+)\s*[:=]\s*function\([^)]*\)\s*\{\s*/ || /([gs]et\s+\w+)\([^)]*\)\s*\{\s*/) {
        $funcName = $1;
        $retNum = 1;
        $throwNum = 1;
        my $call = "if (abp) abp.log('$curFileName', $lineNum, '$funcName', arguments, 'enter');";
        s/(function \w+\([^)]*\)\s*\{[^\S\n]*)/$1$call/
          || s/(\w+\s*[:=]\s*function\([^)]*\)\s*\{[^\S\n]*)/$1$call/
          || s/([gs]et\s+\w+\([^)]*\)\s*\{[^\S\n]*)/$1$call/;
      }
      if ($funcName && /return[^;]*;/) {
        s/(return[^;]*;)/{if (abp) abp.log('$curFileName', $lineNum, '$funcName', arguments, 'return$retNum');$1}/;
        $retNum++;
      }
      if ($funcName && /throw[^;]*;/) {
        s/(throw[^;]*;)/{if (abp) abp.log('$curFileName', $lineNum, '$funcName', arguments, 'throw$throwNum');$1}/;
        $throwNum++;
      }

      $lineNum += tr/\n//;

      return $_;
    };

    $params{postprocess_file} = sub {
      my ($fileName, $file) = @_;
      print $file $abpPostfix if $fileName =~ /nsAdblockPlus.js$/;
    };
  }
  shift @ARGV;
}

$params{locales} = \@ARGV if @ARGV;

my $pkg = Packager->new(\%params);
$pkg->readVersion('version');
$pkg->readLocales('chrome/locale') unless exists $params{locales};

chdir('chrome');
$pkg->makeJAR('adblockplus.jar', 'content', 'skin', 'locale');
chdir('..');

$pkg->makeXPI($xpiFile, 'chrome/adblockplus.jar', 'components', 'defaults', 'install.js', 'install.rdf', 'chrome.manifest');
unlink('chrome/adblockplus.jar');
