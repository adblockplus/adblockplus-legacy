#!/usr/bin/perl

#############################################################################
# This script will set up a test version of the extension in the profiles   #
# listed in .profileDirs file (one per line). This means that manifests,    #
# components and preferences are copied to the profile (and must be         #
# copied again on changes) while current directory is used for the chrome.  #
# If you set nglayout.debug.disable_xul_cache preference to true the        #
# changes in current directory will be available in the application without #
# restart. Also, tests (if any) will be available under                     #
# chrome://mochikit/content/harness-???.xul.                                #
#                                                                           #
# Example of .profileDirs contents:                                         #
#                                                                           #
#  c:\Documents and Setting\<user>\Application Data\Mozilla\Firefox\Profiles\<seed>.default
#  c:\Documents and Setting\<user>\Application Data\Songbird1\Profiles\<seed>.default
#                                                                           #
#############################################################################

use strict;
use warnings;
use Cwd;

my $version = readFile("version");
$version =~ s/[^\w\.]//gs;

opendir(local* LOCALES, "chrome/locale") || die "Could not read directory chrome/locales";
my @locales = grep {!/[^\w\-]/} readdir(LOCALES);
@locales = sort {$a eq "en-US" ? -1 : ($b eq "en-US" ? 1 : $a cmp $b)} @locales; 
closedir(LOCALES);

my @files = ();
my $installManifest = fixupFile(readFile("install.rdf"));
push @files, ["install.rdf", $installManifest];

my $cleanManifest = $installManifest;
$cleanManifest =~ s/<(\w+:)?targetApplication>.*?<\/\1targetApplication>//gs;
$cleanManifest =~ s/<(\w+:)?requires>.*?<\/\1requires>//gs;

die "Failed to extract extension name from install manifest" unless $cleanManifest =~ /<(\w+:)?name>([^<>]+)<\/\1name>/;
my $name = $2;

die "Failed to extract extension ID from install manifest" unless $cleanManifest =~ /<(\w+:)?id>([^<>]+)<\/\1id>/;
my $id = $2;

my $chromeManifest = fixupFile(readFile("chrome.manifest"));
my $baseURL = cwd;
$baseURL =~ s/\\/\//g;
$baseURL = "file:///$baseURL";
$chromeManifest =~ s~jar:chrome/\w+\.jar!~$baseURL/chrome~g;
$chromeManifest =~ s~^\s*resource\s+\S+\s+~$&$baseURL/~gmi;
$chromeManifest =~ s~^content ~content   mochikit $baseURL/chrome/content/mochitest/\n$&~m if -d "chrome/content/mochitest";

push @files, ["chrome.manifest", $chromeManifest];

my @dirs;
if (open(local *DIRS, ".profileDirs"))
{
  @dirs = map {s/[\r\n]//g;$_} <DIRS>;
  close(DIRS);
}
unless (@dirs)
{
  print STDERR <<EOT;
This script requires a file with the name .profileDirs to be in the current
directory. Please create this file and specify the directories of the profiles
where you want to install a test version of $name, one per line.
For example:

  c:\\Documents and Setting\\<user>\\Application Data\\Mozilla\\Firefox\\Profiles\\<seed>.default
  c:\\Documents and Setting\\<user>\\Application Data\\Songbird1\\Profiles\\<seed>.default
EOT
  exit 1;
}

foreach my $file (<components/*.js>, <defaults/preferences/*.js>)
{
  push @files, [$file, fixupFile(readFile($file))];
}

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

  my $baseDir = "$dir/extensions/$id";
  rm_rec($baseDir);

  mkdir($baseDir);

  foreach my $file (@files)
  {
    my ($filename, $content) = @$file;

    my @parentDirs = split(/\//, $filename);
    pop @parentDirs;
    my $parentDir = $baseDir;
    foreach (@parentDirs)
    {
      $parentDir .= "/" . $_;
      mkdir($parentDir);
    }

    writeFile("$baseDir/$filename", $content);
  }
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
