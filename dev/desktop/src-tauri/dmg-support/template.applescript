-- AppleScript template for create-dmg Finder customization
-- Variables are replaced by bundle_dmg.sh

on run (volumeName)
	tell application "Finder"
		tell disk (volumeName as string)
			open

			set theXOrigin to WINX
			set theYOrigin to WINY
			set theWidth to WINW
			set theHeight to WINH

			set theBottomRightX to (theXOrigin + theWidth)
			set theBottomRightY to (theYOrigin + theHeight)
			set dsStore to "\"" & "/Volumes/" & volumeName & "/" & ".DS_Store\""

			tell container window
				set current view to icon view
				set toolbar visible to false
				set statusbar visible to false
				set the bounds to {theXOrigin, theYOrigin, theBottomRightX, theBottomRightY}
				set statusbar visible to false
				REPOSITION_HIDDEN_FILES_CLAUSE
			end tell

			set opts to the icon view options of container window
			tell opts
				set icon size to ICON_SIZE
				set text size to TEXT_SIZE
				set arrangement to not arranged
			end tell
			BACKGROUND_CLAUSE

			-- Positioning
			POSITION_CLAUSE

			-- Hiding
			HIDING_CLAUSE

			-- Application top-level window fix
			APPLICATION_CLAUSE

			-- QuickLook top-level window fix
			QL_CLAUSE

			close
			open

			update without registering applications
			-- delay 1

			tell container window
				set statusbar visible to false
				set the bounds to {theXOrigin, theYOrigin, theBottomRightX, theBottomRightY}
			end tell

			update without registering applications
		end tell
		-- delay 1

		tell disk (volumeName as string)
			tell container window
				set statusbar visible to false
				set the bounds to {theXOrigin, theYOrigin, theBottomRightX, theBottomRightY}
			end tell
			update without registering applications
		end tell
		--give Finder some time to write the .DS_Store file
		delay 3
	end tell
end run
