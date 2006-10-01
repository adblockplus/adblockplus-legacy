#!/usr/bin/perl

use strict;

open(VERSION, "version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

my $output_file = shift @ARGV || "adblockplus.xpi";

if ($ARGV[0] =~ /^\+/)
{
  $version .= $ARGV[0];
  shift @ARGV;
}

my $debug = ($version =~ /debug$/);
my $abpPostfix = "";
if ($debug) {
  $abpPostfix = <<'EOT';
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
}

my @locales;
if (@ARGV)
{
  @locales = @ARGV;
}
else
{
  opendir(LOCALES, "chrome/locale");
  @locales = grep {!/[^\w\-]/ && !/CVS/} readdir(LOCALES);
  closedir(LOCALES);
  
  @locales = sort {$a eq "en-US" ? -1 : ($b eq "en-US" ? 1 : $a cmp $b)} @locales;
}

rm_rec('tmp');
mkdir('tmp');
cp_rec($_, "tmp/$_") foreach ('chrome', 'components', 'defaults');
cp($_, "tmp/$_", 1) foreach ('install.js', 'install.rdf', 'chrome.manifest');
chdir('tmp');

chdir('chrome');
print `zip -rX0 adblockplus.jar content skin locale`;
rm_rec($_) foreach ('content', 'skin', 'locale');
chdir('..');

unlink('../$output_file');
print `zip -rX9 ../$output_file chrome components defaults install.js install.rdf chrome.manifest`;

chdir('..');
rm_rec('tmp');

fixup_permissions($output_file);

sub rm_rec
{
  my $dir = shift;

  opendir(local *DIR, $dir) or return;
  foreach my $file (readdir(DIR))
  {
    if ($file =~ /[^.]/)
    {
      if (-d "$dir/$file")
      {
        rm_rec("$dir/$file");
      }
      else
      {
        unlink("$dir/$file");
      }
    }
  }
  closedir(DIR);

  rmdir($dir);
}

sub cp
{
  my ($fromfile, $tofile, $replace_version) = @_;

  my $funcName = '';
  my $fileName = $tofile;
  $fileName =~ s/.*\///;
  my $lineNum = 1;
  my $retNum;
  my $throwNum;

  my $text = ($fromfile =~ /\.(manifest|xul|js|xml|xhtml|rdf|dtd|properties|css)$/);
  open(local *FROM, $fromfile) or return;
  open(local *TO, ">$tofile") or return;
  binmode(TO);
  if ($text)
  {
    print TO map {
      s/\r//g;
      s/^((?:  )+)/"\t" x (length($1)\/2)/e;
      s/\{\{VERSION\}\}/$version/g if $replace_version;
      if ($replace_version && /\{\{LOCALE\}\}/)
      {
        my $loc = "";
        for my $locale (@locales)
        {
          my $tmp = $_;
          $tmp =~ s/\{\{LOCALE\}\}/$locale/g;
          $loc .= $tmp;
        }
        $_ = $loc;
      }
      if ($debug && $tofile =~ /\.js/) {
        if (/function (\w+)\([^)]*\)\s*\{\s*/ || /(\w+)\s*[:=]\s*function\([^)]*\)\s*\{\s*/ || /([gs]et\s+\w+)\([^)]*\)\s*\{\s*/) {
          $funcName = $1;
          $retNum = 1;
          $throwNum = 1;
          my $call = "if (abp) abp.log('$fileName', $lineNum, '$funcName', arguments, 'enter');";
          s/(function \w+\([^)]*\)\s*\{[^\S\n]*)/$1$call/
            || s/(\w+\s*[:=]\s*function\([^)]*\)\s*\{[^\S\n]*)/$1$call/
            || s/([gs]et\s+\w+\([^)]*\)\s*\{[^\S\n]*)/$1$call/;
        }
        if ($funcName && /return[^;]*;/) {
          s/(return[^;]*;)/{if (abp) abp.log('$fileName', $lineNum, '$funcName', arguments, 'return$retNum');$1}/;
          $retNum++;
        }
        if ($funcName && /throw[^;]*;/) {
          s/(throw[^;]*;)/{if (abp) abp.log('$fileName', $lineNum, '$funcName', arguments, 'throw$throwNum');$1}/;
          $throwNum++;
        }
      }
      $lineNum += tr/\n//;
      $_;
    } <FROM>;
  }
  else
  {
    local $/;
    binmode(FROM) unless $text;
    print TO <FROM>;
  }

  print TO $abpPostfix if $debug && $tofile =~ /nsAdblockPlus.js$/;

  close(TO);
  close(FROM);
}

sub cp_rec
{
  my ($fromdir, $todir) = @_;

  my @files;
  if ($fromdir eq "chrome/locale")
  {
    @files = @locales;
  }
  else
  {
    opendir(local *DIR, $fromdir) or return;
    @files = readdir(DIR);
    closedir(DIR);
  }

  mkdir($todir);
  foreach my $file (@files)
  {
    if ($file =~ /[^.]/ && $file ne 'CVS')
    {
      if (-d "$fromdir/$file")
      {
        cp_rec("$fromdir/$file", "$todir/$file");
      }
      else
      {
        cp("$fromdir/$file", "$todir/$file", $file eq "nsAdblockPlus.js");
      }
    }
  }
}

sub fixup_permissions
{
  my $filename = shift;
  my $invalid = 0;
  my($buf, $entries, $dirlength);

  open(local *FILE, "+<", $filename) or ($invalid = 1);
  unless ($invalid)
  {
    seek(FILE, -22, 2);
    sysread(FILE, $buf, 22);
    (my $signature, $entries, $dirlength) = unpack("Vx6vVx6", $buf);
    if ($signature != 0x06054b50)
    {
      print STDERR "Wrong end of central dir signature!\n";
      $invalid = 1;
    }
  }
  unless ($invalid)
  {
    seek(FILE, -22-$dirlength, 2);
    for (my $i = 0; $i < $entries; $i++)
    {
      sysread(FILE, $buf, 46);
      my ($signature, $namelen, $attributes) = unpack("Vx24vx8V", $buf);
      if ($signature != 0x02014b50)
      {
        print STDERR "Wrong central file header signature!\n";
        $invalid = 1;
        last;
      }
      my $attr_high = $attributes >> 16;
      $attr_high = ($attr_high & ~0777) | ($attr_high & 040000 ? 0755 : 0644);
      $attributes = ($attributes & 0xFFFF) | ($attr_high << 16);
      seek(FILE, -8, 1);
      syswrite(FILE, pack("V", $attributes));
      seek(FILE, 4 + $namelen, 1);
    }
  }
  close(FILE);

  unlink $filename if $invalid;
}
