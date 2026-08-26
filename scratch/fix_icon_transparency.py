import sys
from PIL import Image, ImageDraw

def make_transparent(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    w, h = img.size
    
    # 1. Floodfill from 4 corners to find white background mask if corners are white
    # Or create a smooth rounded mask for the icon
    
    # Let's inspect background color at corner
    corner_color = img.getpixel((0, 0))
    print(f"Corner color: {corner_color}")
    
    # Create mask for white background (pixels near white e.g. RGB > 240)
    # Floodfill from (0,0), (w-1,0), (0,h-1), (w-1,h-1)
    mask = Image.new("L", (w, h), 255)
    
    # We can use ImageDraw.floodfill or distance to white + position
    # Let's find the bounding box of non-white or apply smooth rounded mask
    # For VS Code extension icons, either a transparent background around the rounded square icon
    # OR a completely transparent background around the emblem itself!
    
    # Let's create an anti-aliased rounded rectangle mask matching the card boundary:
    # 4x supersampling for high quality anti-aliasing
    scale = 4
    large_mask = Image.new("L", (w * scale, h * scale), 0)
    draw = ImageDraw.Draw(large_mask)
    
    # Corner radius approx 20% of size (standard squircle / rounded rect: ~90-100px for 512px)
    # Let's check where the card edge actually is by scanning from corners inward
    
    # Scan from (0,0) down diagonal to find where dark color begins
    card_margin = 0
    for i in range(w // 2):
        r, g, b, a = img.getpixel((i, i))
        if r < 240 or g < 240 or b < 240:
            card_margin = i
            break
            
    print(f"Card margin detected on diagonal: {card_margin}")
    
    # If card_margin > 0, the image has a white margin around a rounded rectangle.
    # We can clip to the rounded rectangle OR floodfill the surrounding white area to alpha 0!
    
    # Let's do floodfill / color-based transparency for all connected white pixels from the 4 outer corners
    pixels = img.load()
    
    # Using BFS floodfill from 4 corners to remove pure white background
    visited = set()
    queue = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    
    threshold = 235  # Threshold for white background
    
    for q in queue:
        visited.add(q)
        
    while queue:
        x, y = queue.pop(0)
        r, g, b, a = pixels[x, y]
        
        # Make this pixel fully transparent
        pixels[x, y] = (r, g, b, 0)
        
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                nr, ng, nb, na = pixels[nx, ny]
                # Check if near white
                if nr >= threshold and ng >= threshold and nb >= threshold:
                    visited.add((nx, ny))
                    queue.append((nx, ny))
                    
    # Also smooth alpha channel near edges for anti-aliasing
    img.save(output_path, "PNG")
    print(f"Saved transparent icon to {output_path}")

if __name__ == "__main__":
    make_transparent("icon.png", "icon.png")
