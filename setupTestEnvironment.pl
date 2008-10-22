#!/usr/bin/perl

use strict;
use warnings;
use Cwd;

my @dirs;
if (open(local *DIRS, ".profileDirs"))
{
  @dirs = map {s/[\r\n]//g;$_} <DIRS>;
  close(DIRS);
}
my (@syncDirs, $pkg);

unless (@dirs)
{
  print STDERR <<'EOT';
This script requires a file with the name .profileDirs to be in the current
directory. Please create this file and specify the directories of the profiles
where you want to install a test version of Adblock Plus, one per line. For
example:

  c:\Documents and Setting\<user>\Application Data\Mozilla\Firefox\Profiles\<seed>.default
  c:\Documents and Setting\<user>\Application Data\Songbird1\Profiles\<seed>.default
EOT
  exit 1;
}

my $version = readFile("version");
$version =~ s/[^\w\.]//gs;

opendir(local* LOCALES, "chrome/locale") || die "Could not read directory chrome/locales";
my @locales = grep {!/[^\w\-]/ && !/CVS/} readdir(LOCALES);
@locales = sort {$a eq "en-US" ? -1 : ($b eq "en-US" ? 1 : $a cmp $b)} @locales; 
closedir(LOCALES);

my $install = fixupFile(readFile("install.rdf"));
my $manifest = fixupFile(readFile("chrome.manifest"));
my $component = fixupFile(readFile("components/nsAdblockPlus.js"));
my $prefs = fixupFile(readFile("defaults/preferences/adblockplus.js"));

my $baseURL = cwd;
$baseURL =~ s/\\/\//g;
$baseURL = "file:///$baseURL/chrome";
$manifest =~ s~jar:chrome/adblockplus\.jar!~$baseURL~g;
$manifest =~ s~^content ~content   mochikit $baseURL/content/mochitest/\n$&~m;

foreach my $dir (@dirs)
{
  unless (-e $dir)
  {
    warn "Directory '$dir' not found, skipping";
    next;
  }
  unless (-e "$dir/extensions")
  {
    warn "Directory '$dir/extensions' not found, skipping";
    next;
  }

  my $baseDir = "$dir/extensions/{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}";
  rm_rec($baseDir);

  mkdir($baseDir);
  mkdir("$baseDir/components");
  mkdir("$baseDir/defaults");
  mkdir("$baseDir/defaults/preferences");

  writeFile("$baseDir/install.rdf", $install);
  writeFile("$baseDir/chrome.manifest", $manifest);
  writeFile("$baseDir/components/nsAdblockPlus.js", $component);
  writeFile("$baseDir/defaults/preferences/adblockplus.js", $prefs);
}

sub readFile
{
  my $file = shift;

  open(local *FILE, "<", $file) || die "Could not read file '$file'";
  binmode(FILE);
  local $/;
  my $result = <FILE>;
  close(FILE);

  return $result;
}

sub writeFile
{
  my ($file, $contents) = @_;

  open(local *FILE, ">", $file) || die "Could not write file '$file'";
  binmode(FILE);
  print FILE $contents;
  close(FILE);
}

sub fixupFile
{
  my $str = shift;

  $str =~ s/{{VERSION}}/$version/g;
  $str =~ s/^.*{{LOCALE}}.*$/
    my @result = ();
    my $template = $&;
    foreach my $locale (@locales)
    {
      push(@result, $template);
      $result[-1] =~ s~{{LOCALE}}~$locale~g;
    }
    join("\n", @result);
  /mge;

  return $str;
}

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
